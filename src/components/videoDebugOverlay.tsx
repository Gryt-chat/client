import { useEffect, useState } from "react";

import { useCamera, useScreenShare, useSFU } from "@gryt/voice";
import {
  type InboundVideoStats,
  type OutboundVideoStats,
  useVideoStats,
} from "@gryt/voice";

import { PiVideoCameraFill } from "../lib/icons";
import { DebugOverlay } from "./debugOverlay";

interface VideoDebugOverlayProps {
  isVisible: boolean;
}

type VideoLabel = "camera" | "screen" | "video";

interface CandidateDiagnostics {
  availableInKbps: number | null;
  bytesDiscardedOnSend: number | null;
  packetsDiscardedOnSend: number | null;
  localCandidateType: string | null;
  localNetworkType: string | null;
  remoteCandidateType: string | null;
  protocol: string | null;
}

interface SenderDiagnostics {
  label: VideoLabel;
  trackId: string | null;
  readyState: MediaStreamTrackState | null;
  enabled: boolean | null;
  muted: boolean | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  encodingActive: boolean | null;
  maxBitrateKbps: number | null;
}

interface OutboundDiagnostics {
  label: VideoLabel;
  targetBitrateKbps: number | null;
  retransmittedPacketsSent: number | null;
  retransmittedBytesSent: number | null;
  averagePacketSendDelayMs: number | null;
  remoteRttMs: number | null;
  remoteJitterMs: number | null;
  remotePacketsLost: number | null;
  remoteLossPct: number | null;
  reportsReceived: number | null;
  bandwidthLimitedSeconds: number | null;
  cpuLimitedSeconds: number | null;
  otherLimitedSeconds: number | null;
  resolutionChanges: number | null;
  averageQp: number | null;
  codecFmtp: string | null;
}

interface VideoDiagnostics {
  connectionState: RTCPeerConnectionState | null;
  iceConnectionState: RTCIceConnectionState | null;
  signalingState: RTCSignalingState | null;
  candidate: CandidateDiagnostics;
  senders: SenderDiagnostics[];
  outbound: OutboundDiagnostics[];
}

const EMPTY_DIAGNOSTICS: VideoDiagnostics = {
  connectionState: null,
  iceConnectionState: null,
  signalingState: null,
  candidate: {
    availableInKbps: null,
    bytesDiscardedOnSend: null,
    packetsDiscardedOnSend: null,
    localCandidateType: null,
    localNetworkType: null,
    remoteCandidateType: null,
    protocol: null,
  },
  senders: [],
  outbound: [],
};

const sectionTitle: React.CSSProperties = {
  color: "var(--gryt-secondary-11)",
  fontWeight: "bold",
  marginBottom: "4px",
};

const indent: React.CSSProperties = {
  marginLeft: "8px",
  fontSize: "11px",
};

function fmt(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function fmtInt(v: number | null): string {
  if (v == null) return "—";
  return String(Math.round(v));
}

function fmtBytes(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${fmt(v / 1_000_000, 1)} MB`;
  if (v >= 1_000) return `${fmt(v / 1_000, 1)} KB`;
  return `${fmtInt(v)} B`;
}

function resolution(w: number | null, h: number | null): string {
  if (w == null || h == null) return "—";
  return `${w}x${h}`;
}

function labelTitle(label: VideoLabel): string {
  if (label === "screen") return "Screen Share";
  if (label === "camera") return "Camera";
  return "Video";
}

function labelForTrack(
  trackId: string | null,
  cameraTrackId: string | null,
  screenTrackId: string | null,
): VideoLabel {
  if (trackId && cameraTrackId && trackId === cameraTrackId) return "camera";
  if (trackId && screenTrackId && trackId === screenTrackId) return "screen";
  return "video";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function useVideoDebugDiagnostics(enabled: boolean): VideoDiagnostics {
  const {
    getPeerConnection,
    getCameraSenderTrackId,
    getScreenSenderTrackId,
  } = useSFU();
  const [diagnostics, setDiagnostics] = useState<VideoDiagnostics>(EMPTY_DIAGNOSTICS);

  useEffect(() => {
    if (!enabled) {
      setDiagnostics(EMPTY_DIAGNOSTICS);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      const pc = getPeerConnection?.();
      if (!pc) {
        if (!cancelled) setDiagnostics(EMPTY_DIAGNOSTICS);
        return;
      }

      try {
        const report = await pc.getStats();
        const byId = new Map<string, any>();
        report.forEach((stat) => byId.set(stat.id, stat));

        const cameraTrackId = getCameraSenderTrackId?.() ?? null;
        const screenTrackId = getScreenSenderTrackId?.() ?? null;

        let selectedPair: any = null;
        report.forEach((stat) => {
          if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.nominated) {
            selectedPair = stat;
          }
        });

        const localCandidate = selectedPair?.localCandidateId
          ? byId.get(selectedPair.localCandidateId)
          : null;
        const remoteCandidate = selectedPair?.remoteCandidateId
          ? byId.get(selectedPair.remoteCandidateId)
          : null;

        const senders: SenderDiagnostics[] = pc.getSenders()
          .filter((sender) => sender.track?.kind === "video")
          .map((sender) => {
            const track = sender.track;
            const settings = track?.getSettings();
            const encoding = sender.getParameters().encodings?.[0];

            return {
              label: labelForTrack(track?.id ?? null, cameraTrackId, screenTrackId),
              trackId: track?.id ?? null,
              readyState: track?.readyState ?? null,
              enabled: track?.enabled ?? null,
              muted: track?.muted ?? null,
              width: numberOrNull(settings?.width),
              height: numberOrNull(settings?.height),
              frameRate: numberOrNull(settings?.frameRate),
              encodingActive: typeof encoding?.active === "boolean" ? encoding.active : null,
              maxBitrateKbps:
                typeof encoding?.maxBitrate === "number" ? encoding.maxBitrate / 1000 : null,
            };
          });

        const outbound: OutboundDiagnostics[] = [];
        report.forEach((stat) => {
          if (stat.type !== "outbound-rtp" || stat.kind !== "video") return;

          const trackId = typeof stat.trackIdentifier === "string" ? stat.trackIdentifier : null;
          const remote = stat.remoteId ? byId.get(stat.remoteId) : null;
          const codec = stat.codecId ? byId.get(stat.codecId) : null;
          const durations = stat.qualityLimitationDurations as
            | Record<string, number>
            | undefined;
          const packetsSent = numberOrNull(stat.packetsSent);
          const totalPacketSendDelay = numberOrNull(stat.totalPacketSendDelay);
          const framesEncoded = numberOrNull(stat.framesEncoded);
          const qpSum = numberOrNull(stat.qpSum);

          outbound.push({
            label: labelForTrack(trackId, cameraTrackId, screenTrackId),
            targetBitrateKbps:
              typeof stat.targetBitrate === "number" ? stat.targetBitrate / 1000 : null,
            retransmittedPacketsSent: numberOrNull(stat.retransmittedPacketsSent),
            retransmittedBytesSent: numberOrNull(stat.retransmittedBytesSent),
            averagePacketSendDelayMs:
              totalPacketSendDelay != null && packetsSent != null && packetsSent > 0
                ? (totalPacketSendDelay * 1000) / packetsSent
                : null,
            remoteRttMs:
              typeof remote?.roundTripTime === "number" ? remote.roundTripTime * 1000 : null,
            remoteJitterMs:
              typeof remote?.jitter === "number" ? remote.jitter * 1000 : null,
            remotePacketsLost: numberOrNull(remote?.packetsLost),
            remoteLossPct:
              typeof remote?.fractionLost === "number" ? remote.fractionLost * 100 : null,
            reportsReceived: numberOrNull(remote?.reportsReceived),
            bandwidthLimitedSeconds: numberOrNull(durations?.bandwidth),
            cpuLimitedSeconds: numberOrNull(durations?.cpu),
            otherLimitedSeconds: numberOrNull(durations?.other),
            resolutionChanges: numberOrNull(stat.qualityLimitationResolutionChanges),
            averageQp:
              qpSum != null && framesEncoded != null && framesEncoded > 0
                ? qpSum / framesEncoded
                : null,
            codecFmtp:
              typeof codec?.sdpFmtpLine === "string" && codec.sdpFmtpLine.length > 0
                ? codec.sdpFmtpLine
                : null,
          });
        });

        if (!cancelled) {
          setDiagnostics({
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            signalingState: pc.signalingState,
            candidate: {
              availableInKbps:
                typeof selectedPair?.availableIncomingBitrate === "number"
                  ? selectedPair.availableIncomingBitrate / 1000
                  : null,
              bytesDiscardedOnSend: numberOrNull(selectedPair?.bytesDiscardedOnSend),
              packetsDiscardedOnSend: numberOrNull(selectedPair?.packetsDiscardedOnSend),
              localCandidateType:
                typeof localCandidate?.candidateType === "string"
                  ? localCandidate.candidateType
                  : null,
              localNetworkType:
                typeof localCandidate?.networkType === "string"
                  ? localCandidate.networkType
                  : null,
              remoteCandidateType:
                typeof remoteCandidate?.candidateType === "string"
                  ? remoteCandidate.candidateType
                  : null,
              protocol:
                typeof remoteCandidate?.protocol === "string"
                  ? remoteCandidate.protocol
                  : typeof localCandidate?.protocol === "string"
                    ? localCandidate.protocol
                    : null,
            },
            senders,
            outbound,
          });
        }
      } catch {
        // getStats can race peer-connection shutdown.
      }
    };

    poll();
    const interval = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, getPeerConnection, getCameraSenderTrackId, getScreenSenderTrackId]);

  return diagnostics;
}

function SenderSection({ s }: { s: SenderDiagnostics }) {
  const stateParts = [
    s.readyState ?? "—",
    s.enabled == null ? null : s.enabled ? "enabled" : "disabled",
    s.muted == null ? null : s.muted ? "muted" : "unmuted",
  ].filter(Boolean);

  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>Sender — {labelTitle(s.label)}:</div>
      <div style={indent}>
        <div>Track: {stateParts.join(" / ")}</div>
        <div>
          Capture: {resolution(s.width, s.height)}
          {s.frameRate != null ? ` @ ${fmt(s.frameRate, 1)} fps` : ""}
        </div>
        <div>
          Encoding: {s.encodingActive == null ? "—" : s.encodingActive ? "active" : "inactive"}
          {" / "}max {s.maxBitrateKbps != null ? `${fmtInt(s.maxBitrateKbps)} kbps` : "—"}
        </div>
      </div>
    </div>
  );
}

function OutboundSection({
  s,
  diagnostics,
}: {
  s: OutboundVideoStats;
  diagnostics?: OutboundDiagnostics;
}) {
  const title = s.label === "screen" ? "Screen Share" : "Camera";
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>Outbound — {title}:</div>
      <div style={indent}>
        <div>Codec: {s.codec ?? "—"}</div>
        {diagnostics?.codecFmtp && <div>Codec params: {diagnostics.codecFmtp}</div>}
        <div>Resolution: {resolution(s.frameWidth, s.frameHeight)}</div>
        <div>FPS: {fmt(s.framesPerSecond, 0)}</div>
        <div>Bitrate: {s.bitrateKbps != null ? `${fmt(s.bitrateKbps)} kbps` : "—"}</div>
        <div>
          Target: {diagnostics?.targetBitrateKbps != null
            ? `${fmtInt(diagnostics.targetBitrateKbps)} kbps`
            : "—"}
        </div>
        <div>Packets sent: {fmtInt(s.packetsSent)}</div>
        <div>
          Retransmit: {fmtInt(diagnostics?.retransmittedPacketsSent ?? null)} pkts /{" "}
          {fmtBytes(diagnostics?.retransmittedBytesSent ?? null)}
        </div>
        <div>
          Send delay: {diagnostics?.averagePacketSendDelayMs != null
            ? `${fmt(diagnostics.averagePacketSendDelayMs, 2)} ms/pkt`
            : "—"}
        </div>
        <div>Frames: {fmtInt(s.framesEncoded)} enc / {fmtInt(s.keyFramesEncoded)} key</div>
        <div>Encode time: {s.totalEncodeTimeMs != null ? `${fmt(s.totalEncodeTimeMs)} ms` : "—"}</div>
        <div>Avg QP: {fmt(diagnostics?.averageQp ?? null, 1)}</div>
        <div>PLI: {fmtInt(s.pliCount)} / NACK: {fmtInt(s.nackCount)}</div>
        <div>
          Remote RTCP: RTT {diagnostics?.remoteRttMs != null
            ? `${fmt(diagnostics.remoteRttMs)} ms`
            : "—"}
          {" / "}jitter {diagnostics?.remoteJitterMs != null
            ? `${fmt(diagnostics.remoteJitterMs)} ms`
            : "—"}
        </div>
        <div>
          Remote loss: {diagnostics?.remoteLossPct != null
            ? `${fmt(diagnostics.remoteLossPct, 2)}%`
            : "—"}
          {" / "}{fmtInt(diagnostics?.remotePacketsLost ?? null)} pkts
          {" / "}{fmtInt(diagnostics?.reportsReceived ?? null)} reports
        </div>
        <div
          style={{
            color:
              s.qualityLimitationReason && s.qualityLimitationReason !== "none"
                ? "var(--gryt-warning-11)"
                : undefined,
          }}
        >
          Quality limit: {s.qualityLimitationReason ?? "—"}
        </div>
        <div>
          Limit time: bw {fmt(diagnostics?.bandwidthLimitedSeconds ?? null, 1)}s / cpu{" "}
          {fmt(diagnostics?.cpuLimitedSeconds ?? null, 1)}s / other{" "}
          {fmt(diagnostics?.otherLimitedSeconds ?? null, 1)}s
        </div>
        <div>Resolution changes: {fmtInt(diagnostics?.resolutionChanges ?? null)}</div>
        <div>SVC mode: {s.scalabilityMode ?? "—"}</div>
        <div>Encoder: {s.encoderImplementation ?? "—"}</div>
      </div>
    </div>
  );
}

function InboundSection({ s, index }: { s: InboundVideoStats; index: number }) {
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>Inbound #{index + 1}:</div>
      <div style={indent}>
        <div>Codec: {s.codec ?? "—"}</div>
        <div>Resolution: {resolution(s.frameWidth, s.frameHeight)}</div>
        <div>FPS: {fmt(s.framesPerSecond, 0)}</div>
        <div>Bitrate: {s.bitrateKbps != null ? `${fmt(s.bitrateKbps)} kbps` : "—"}</div>
        <div>Jitter: {s.jitterMs != null ? `${fmt(s.jitterMs)} ms` : "—"}</div>
        <div>Packets: {fmtInt(s.packetsReceived)} recv / {fmtInt(s.packetsLost)} lost</div>
        <div>Frames: {fmtInt(s.framesDecoded)} decoded / {fmtInt(s.framesDropped)} dropped</div>
        <div>Decoder: {s.decoderImplementation ?? "—"}</div>
        <div>PLI: {fmtInt(s.pliCount)} / FIR: {fmtInt(s.firCount)} / NACK: {fmtInt(s.nackCount)}</div>
      </div>
    </div>
  );
}

export function VideoDebugOverlay({ isVisible }: VideoDebugOverlayProps) {
  const stats = useVideoStats(isVisible);
  const diagnostics = useVideoDebugDiagnostics(isVisible);
  const { cameraEnabled } = useCamera();
  const { screenShareActive } = useScreenShare();
  const { isConnected } = useSFU();

  const hasVideo = cameraEnabled || screenShareActive || stats.inbound.length > 0;
  const localPath = [
    diagnostics.candidate.localCandidateType,
    diagnostics.candidate.localNetworkType,
  ].filter(Boolean).join("/");
  const remotePath = diagnostics.candidate.remoteCandidateType;

  return (
    <DebugOverlay
      isVisible={isVisible}
      title="Video Debug"
      icon={<PiVideoCameraFill size={16} />}
      status={{
        active: isConnected && hasVideo,
        label: isConnected ? (hasVideo ? "Streaming" : "No video") : "Disconnected",
      }}
      initialPosition={{ x: window.innerWidth - 680, y: 10 }}
    >
      <div style={{ maxHeight: "calc(100vh - 100px)", overflowY: "auto", paddingRight: "4px" }}>
        <div style={{ marginBottom: "8px" }}>
          <div style={sectionTitle}>Connection:</div>
          <div style={indent}>
            <div>RTT: {stats.connection.rttMs != null ? `${fmt(stats.connection.rttMs)} ms` : "—"}</div>
            <div>Avail out: {stats.connection.availableOutKbps != null ? `${fmtInt(stats.connection.availableOutKbps)} kbps` : "—"}</div>
            <div>Avail in: {diagnostics.candidate.availableInKbps != null ? `${fmtInt(diagnostics.candidate.availableInKbps)} kbps` : "—"}</div>
            <div>
              Path: {localPath || "—"} → {remotePath ?? stats.connection.candidateType ?? "—"}{" "}
              ({diagnostics.candidate.protocol ?? stats.connection.transportProtocol ?? "—"})
            </div>
            <div>
              States: {diagnostics.connectionState ?? "—"} / ICE{" "}
              {diagnostics.iceConnectionState ?? "—"} / signaling{" "}
              {diagnostics.signalingState ?? "—"}
            </div>
            <div>
              Send discarded: {fmtBytes(diagnostics.candidate.bytesDiscardedOnSend)} /{" "}
              {fmtInt(diagnostics.candidate.packetsDiscardedOnSend)} pkts
            </div>
          </div>
        </div>

        {diagnostics.senders.length === 0 && (cameraEnabled || screenShareActive) && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>Sender:</div>
            <div style={{ ...indent, color: "var(--gryt-warning-11)" }}>
              Video enabled but no RTCRtpSender track
            </div>
          </div>
        )}
        {diagnostics.senders.map((s, i) => (
          <SenderSection key={s.trackId ?? `sender-${i}`} s={s} />
        ))}

        {stats.outbound.length === 0 && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>Outbound:</div>
            <div style={{ ...indent, color: "var(--gryt-neutral-9)" }}>No outbound video</div>
          </div>
        )}
        {stats.outbound.map((s, i) => (
          <OutboundSection
            key={`out-${s.label}-${i}`}
            s={s}
            diagnostics={diagnostics.outbound.find((d) => d.label === s.label)}
          />
        ))}

        {stats.inbound.length === 0 && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>Inbound:</div>
            <div style={{ ...indent, color: "var(--gryt-neutral-9)" }}>No inbound video</div>
          </div>
        )}
        {stats.inbound.map((s, i) => (
          <InboundSection key={`in-${s.trackId}-${i}`} s={s} index={i} />
        ))}
      </div>
    </DebugOverlay>
  );
}
