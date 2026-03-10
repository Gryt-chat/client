import { useCallback, useEffect, useRef, useState } from "react";

import { useSettings } from "@/settings";
import { useSFU } from "@/webRTC";

import { useMicrophone } from "./useMicrophone";

export interface LatencyBreakdown {
  // Local audio pipeline
  contextBaseLatencyMs: number | null;
  contextOutputLatencyMs: number | null;
  rnnoiseBufferMs: number | null;

  // WebRTC transport
  networkRttMs: number | null;
  oneWayNetworkMs: number | null;
  jitterMs: number | null;
  jitterBufferMs: number | null;
  packetsLost: number | null;
  packetsSent: number | null;
  packetsReceived: number | null;

  // Codec info
  codec: string | null;
  bitrateKbps: number | null;
  availableOutKbps: number | null;

  // Connection info
  sfuEndpoint: string | null;
  remoteAddress: string | null;
  localAddress: string | null;
  candidateType: string | null;

  // Estimated totals
  localPipelineMs: number | null;
  estimatedOneWayMs: number | null;
  estimatedRoundTripMs: number | null;
}

const EMPTY: LatencyBreakdown = {
  contextBaseLatencyMs: null,
  contextOutputLatencyMs: null,
  rnnoiseBufferMs: null,
  networkRttMs: null,
  oneWayNetworkMs: null,
  jitterMs: null,
  jitterBufferMs: null,
  packetsLost: null,
  packetsSent: null,
  packetsReceived: null,
  codec: null,
  bitrateKbps: null,
  availableOutKbps: null,
  sfuEndpoint: null,
  remoteAddress: null,
  localAddress: null,
  candidateType: null,
  localPipelineMs: null,
  estimatedOneWayMs: null,
  estimatedRoundTripMs: null,
};

export function useVoiceLatency(enabled: boolean) {
  const { rnnoiseEnabled, eSportsModeEnabled, inputMode } = useSettings();
  const { getPeerConnection, isConnected, activeSfuUrl } = useSFU();
  const { audioContext, microphoneBuffer } = useMicrophone(false);

  const [latency, setLatency] = useState<LatencyBreakdown>(EMPTY);
  const prevBytesRef = useRef<{ bytes: number; ts: number } | null>(null);
  const prevJitterBufRef = useRef<{ delay: number; count: number } | null>(null);

  const computeLocalPipeline = useCallback(() => {
    if (!audioContext) return { baseMs: null, outputMs: null, rnnoiseMs: null, totalMs: null };

    const baseMs = typeof audioContext.baseLatency === "number"
      ? audioContext.baseLatency * 1000
      : null;
    const ctx = audioContext as AudioContext & { outputLatency?: number };
    const outputMs = typeof ctx.outputLatency === "number"
      ? ctx.outputLatency * 1000
      : null;

    // AudioWorklet RNNoise latency: one 480-sample frame for accumulation + one for output
    let rnnoiseMs: number | null = null;
    if (rnnoiseEnabled && microphoneBuffer.rnnoiseNode) {
      const sampleRate = audioContext.sampleRate || 48000;
      rnnoiseMs = (480 / sampleRate) * 1000 * 2;
    }

    let totalMs = 0;
    if (baseMs !== null) totalMs += baseMs;
    if (rnnoiseMs !== null) totalMs += rnnoiseMs;

    return { baseMs, outputMs, rnnoiseMs, totalMs: totalMs > 0 ? totalMs : null };
  }, [audioContext, rnnoiseEnabled, microphoneBuffer.rnnoiseNode]);

  useEffect(() => {
    if (!enabled) {
      setLatency(EMPTY);
      prevBytesRef.current = null;
      prevJitterBufRef.current = null;
      return;
    }

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      const local = computeLocalPipeline();

      let networkRttMs: number | null = null;
      let jitterMs: number | null = null;
      let jitterBufferMs: number | null = null;
      let packetsLost: number | null = null;
      let packetsSent: number | null = null;
      let packetsReceived: number | null = null;
      let codec: string | null = null;
      let bitrateKbps: number | null = null;
      let availableOutKbps: number | null = null;
      let remoteAddress: string | null = null;
      let localAddress: string | null = null;
      let candidateType: string | null = null;

      const pc = getPeerConnection?.();
      if (pc && isConnected) {
        try {
          const report = await pc.getStats();
          const codecMap = new Map<string, string>();
          const candidateMap = new Map<string, { address: string; port: number; candidateType: string; protocol: string }>();

          report.forEach((stat) => {
            if (stat.type === "codec") {
              codecMap.set(stat.id, (stat as { mimeType?: string }).mimeType || "unknown");
            }
            if (stat.type === "remote-candidate" || stat.type === "local-candidate") {
              candidateMap.set(stat.id, {
                address: stat.address ?? stat.ip ?? "?",
                port: stat.port ?? 0,
                candidateType: stat.candidateType ?? "?",
                protocol: stat.protocol ?? "?",
              });
            }
          });

          report.forEach((stat) => {
            if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.nominated) {
              if (typeof stat.currentRoundTripTime === "number") {
                networkRttMs = stat.currentRoundTripTime * 1000;
              }
              if (typeof stat.availableOutgoingBitrate === "number") {
                availableOutKbps = stat.availableOutgoingBitrate / 1000;
              }
              const remote = candidateMap.get(stat.remoteCandidateId);
              if (remote) {
                remoteAddress = `${remote.address}:${remote.port}`;
                candidateType = `${remote.candidateType} (${remote.protocol})`;
              }
              const local = candidateMap.get(stat.localCandidateId);
              if (local) {
                localAddress = `${local.address}:${local.port}`;
              }
            }

            if (stat.type === "inbound-rtp" && stat.kind === "audio") {
              if (typeof stat.jitter === "number") {
                jitterMs = stat.jitter * 1000;
              }
              if (typeof stat.packetsLost === "number") {
                packetsLost = stat.packetsLost;
              }
              if (typeof stat.packetsReceived === "number") {
                packetsReceived = stat.packetsReceived;
              }
              if (stat.codecId && codecMap.has(stat.codecId)) {
                codec = codecMap.get(stat.codecId) || null;
              }
              if (typeof stat.jitterBufferDelay === "number" &&
                  typeof stat.jitterBufferEmittedCount === "number" &&
                  stat.jitterBufferEmittedCount > 0) {
                const prev = prevJitterBufRef.current;
                if (prev && stat.jitterBufferEmittedCount > prev.count) {
                  const dDelay = stat.jitterBufferDelay - prev.delay;
                  const dCount = stat.jitterBufferEmittedCount - prev.count;
                  jitterBufferMs = (dDelay / dCount) * 1000;
                }
                prevJitterBufRef.current = {
                  delay: stat.jitterBufferDelay,
                  count: stat.jitterBufferEmittedCount,
                };
              }
            }

            if (stat.type === "outbound-rtp" && stat.kind === "audio") {
              if (typeof stat.packetsSent === "number") {
                packetsSent = stat.packetsSent;
              }
              if (typeof stat.bytesSent === "number") {
                const now = performance.now();
                const prev = prevBytesRef.current;
                if (prev) {
                  const dtSec = (now - prev.ts) / 1000;
                  if (dtSec > 0) {
                    bitrateKbps = ((stat.bytesSent - prev.bytes) * 8) / dtSec / 1000;
                  }
                }
                prevBytesRef.current = { bytes: stat.bytesSent, ts: now };
              }
              if (!codec && stat.codecId && codecMap.has(stat.codecId)) {
                codec = codecMap.get(stat.codecId) || null;
              }
            }
          });
        } catch {
          // getStats can throw if pc is closing
        }
      }

      const oneWayNetworkMs = networkRttMs !== null ? networkRttMs / 2 : null;

      let estimatedOneWayMs: number | null = null;
      {
        let sum = 0;
        let hasData = false;
        if (local.totalMs !== null) { sum += local.totalMs; hasData = true; }
        if (oneWayNetworkMs !== null) { sum += oneWayNetworkMs; hasData = true; }
        estimatedOneWayMs = hasData ? Math.max(0, sum) : null;
      }

      const estimatedRoundTripMs = estimatedOneWayMs !== null ? estimatedOneWayMs * 2 : null;

      if (!cancelled) {
        setLatency({
          contextBaseLatencyMs: local.baseMs,
          contextOutputLatencyMs: local.outputMs,
          rnnoiseBufferMs: local.rnnoiseMs,
          networkRttMs,
          oneWayNetworkMs,
          jitterMs,
          jitterBufferMs,
          packetsLost,
          packetsSent,
          packetsReceived,
          codec,
          bitrateKbps,
          availableOutKbps,
          sfuEndpoint: activeSfuUrl ?? null,
          remoteAddress,
          localAddress,
          candidateType,
          localPipelineMs: local.totalMs,
          estimatedOneWayMs,
          estimatedRoundTripMs,
        });
      }
    };

    poll();
    const interval = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      prevBytesRef.current = null;
      prevJitterBufRef.current = null;
    };
  }, [enabled, computeLocalPipeline, getPeerConnection, isConnected, activeSfuUrl]);

  const modeLabel = eSportsModeEnabled
    ? "eSports"
    : inputMode === "push_to_talk"
      ? "Push to Talk"
      : "Voice Activity";

  return { latency, modeLabel };
}
