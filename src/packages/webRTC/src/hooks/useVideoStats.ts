import { useEffect, useRef, useState } from "react";

import { useSFU } from "./useSFU";

export interface OutboundVideoStats {
  label: "camera" | "screen";
  codec: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  bitrateKbps: number | null;
  packetsSent: number | null;
  qualityLimitationReason: string | null;
  scalabilityMode: string | null;
  encoderImplementation: string | null;
}

export interface InboundVideoStats {
  trackId: string;
  codec: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  bitrateKbps: number | null;
  jitterMs: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  decoderImplementation: string | null;
  pliCount: number | null;
  firCount: number | null;
  nackCount: number | null;
}

export interface ConnectionStats {
  rttMs: number | null;
  availableOutKbps: number | null;
  candidateType: string | null;
  transportProtocol: string | null;
}

export interface VideoStatsBreakdown {
  outbound: OutboundVideoStats[];
  inbound: InboundVideoStats[];
  connection: ConnectionStats;
}

const EMPTY: VideoStatsBreakdown = {
  outbound: [],
  inbound: [],
  connection: { rttMs: null, availableOutKbps: null, candidateType: null, transportProtocol: null },
};

interface BytesDelta {
  bytes: number;
  ts: number;
}

export function useVideoStats(enabled: boolean) {
  const { getPeerConnection, isConnected, getScreenSenderTrackId, getCameraSenderTrackId } = useSFU();

  const [stats, setStats] = useState<VideoStatsBreakdown>(EMPTY);
  const outboundBytesRef = useRef<Map<string, BytesDelta>>(new Map());
  const inboundBytesRef = useRef<Map<string, BytesDelta>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setStats(EMPTY);
      outboundBytesRef.current.clear();
      inboundBytesRef.current.clear();
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      const pc = getPeerConnection?.();
      if (!pc || !isConnected) {
        if (!cancelled) setStats(EMPTY);
        return;
      }

      try {
        const report = await pc.getStats();

        const codecMap = new Map<string, string>();
        let rttMs: number | null = null;
        let availableOutKbps: number | null = null;
        let candidateType: string | null = null;
        let transportProtocol: string | null = null;

        const candidateMap = new Map<string, { candidateType: string; protocol: string }>();

        report.forEach((stat) => {
          if (stat.type === "codec") {
            codecMap.set(stat.id, (stat as { mimeType?: string }).mimeType ?? "unknown");
          }
          if (stat.type === "remote-candidate") {
            candidateMap.set(stat.id, {
              candidateType: stat.candidateType ?? "?",
              protocol: stat.protocol ?? "?",
            });
          }
        });

        report.forEach((stat) => {
          if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.nominated) {
            if (typeof stat.currentRoundTripTime === "number") {
              rttMs = stat.currentRoundTripTime * 1000;
            }
            if (typeof stat.availableOutgoingBitrate === "number") {
              availableOutKbps = stat.availableOutgoingBitrate / 1000;
            }
            const remote = candidateMap.get(stat.remoteCandidateId);
            if (remote) {
              candidateType = remote.candidateType;
              transportProtocol = remote.protocol;
            }
          }
        });

        const outbound: OutboundVideoStats[] = [];
        const inbound: InboundVideoStats[] = [];
        const now = performance.now();

        const screenTrackId = getScreenSenderTrackId?.() ?? null;
        const cameraTrackId = getCameraSenderTrackId?.() ?? null;

        report.forEach((stat) => {
          if (stat.type === "outbound-rtp" && stat.kind === "video") {
            const trackIdentifier: string | undefined = stat.trackIdentifier;
            let label: "camera" | "screen" = "camera";
            if (trackIdentifier) {
              if (screenTrackId && trackIdentifier === screenTrackId) label = "screen";
              else if (cameraTrackId && trackIdentifier === cameraTrackId) label = "camera";
              else if (screenTrackId && !cameraTrackId) label = "screen";
            }

            let bitrateKbps: number | null = null;
            const key = `out-${stat.ssrc}`;
            if (typeof stat.bytesSent === "number") {
              const prev = outboundBytesRef.current.get(key);
              if (prev) {
                const dtSec = (now - prev.ts) / 1000;
                if (dtSec > 0) {
                  bitrateKbps = ((stat.bytesSent - prev.bytes) * 8) / dtSec / 1000;
                }
              }
              outboundBytesRef.current.set(key, { bytes: stat.bytesSent, ts: now });
            }

            outbound.push({
              label,
              codec: stat.codecId ? (codecMap.get(stat.codecId) ?? null) : null,
              frameWidth: stat.frameWidth ?? null,
              frameHeight: stat.frameHeight ?? null,
              framesPerSecond: stat.framesPerSecond ?? null,
              bitrateKbps,
              packetsSent: stat.packetsSent ?? null,
              qualityLimitationReason: stat.qualityLimitationReason ?? null,
              scalabilityMode: stat.scalabilityMode ?? null,
              encoderImplementation: stat.encoderImplementation ?? null,
            });
          }

          if (stat.type === "inbound-rtp" && stat.kind === "video") {
            let bitrateKbps: number | null = null;
            const key = `in-${stat.ssrc}`;
            if (typeof stat.bytesReceived === "number") {
              const prev = inboundBytesRef.current.get(key);
              if (prev) {
                const dtSec = (now - prev.ts) / 1000;
                if (dtSec > 0) {
                  bitrateKbps = ((stat.bytesReceived - prev.bytes) * 8) / dtSec / 1000;
                }
              }
              inboundBytesRef.current.set(key, { bytes: stat.bytesReceived, ts: now });
            }

            inbound.push({
              trackId: stat.trackIdentifier ?? stat.ssrc?.toString() ?? "?",
              codec: stat.codecId ? (codecMap.get(stat.codecId) ?? null) : null,
              frameWidth: stat.frameWidth ?? null,
              frameHeight: stat.frameHeight ?? null,
              framesPerSecond: stat.framesPerSecond ?? null,
              bitrateKbps,
              jitterMs: typeof stat.jitter === "number" ? stat.jitter * 1000 : null,
              packetsReceived: stat.packetsReceived ?? null,
              packetsLost: stat.packetsLost ?? null,
              framesDecoded: stat.framesDecoded ?? null,
              framesDropped: stat.framesDropped ?? null,
              decoderImplementation: stat.decoderImplementation ?? null,
              pliCount: stat.pliCount ?? null,
              firCount: stat.firCount ?? null,
              nackCount: stat.nackCount ?? null,
            });
          }
        });

        if (!cancelled) {
          setStats({
            outbound,
            inbound,
            connection: { rttMs, availableOutKbps, candidateType, transportProtocol },
          });
        }
      } catch {
        // getStats can throw if pc is closing
      }
    };

    poll();
    const interval = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, getPeerConnection, isConnected, getScreenSenderTrackId, getCameraSenderTrackId]);

  return stats;
}
