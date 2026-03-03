import { useCamera, useScreenShare } from "@/audio";
import { useSFU } from "@/webRTC";

import {
  type InboundVideoStats,
  type OutboundVideoStats,
  useVideoStats,
} from "../packages/webRTC/src/hooks/useVideoStats";
import { DebugOverlay } from "./debugOverlay";

interface VideoDebugOverlayProps {
  isVisible: boolean;
}

const sectionTitle: React.CSSProperties = {
  color: "var(--blue-11)",
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

function resolution(w: number | null, h: number | null): string {
  if (w == null || h == null) return "—";
  return `${w}x${h}`;
}

function OutboundSection({ s }: { s: OutboundVideoStats }) {
  const title = s.label === "screen" ? "Screen Share" : "Camera";
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>Outbound — {title}:</div>
      <div style={indent}>
        <div>Codec: {s.codec ?? "—"}</div>
        <div>Resolution: {resolution(s.frameWidth, s.frameHeight)}</div>
        <div>FPS: {fmt(s.framesPerSecond, 0)}</div>
        <div>Bitrate: {s.bitrateKbps != null ? `${fmt(s.bitrateKbps)} kbps` : "—"}</div>
        <div>Packets sent: {fmtInt(s.packetsSent)}</div>
        <div
          style={{
            color:
              s.qualityLimitationReason && s.qualityLimitationReason !== "none"
                ? "var(--orange-11)"
                : undefined,
          }}
        >
          Quality limit: {s.qualityLimitationReason ?? "—"}
        </div>
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
  const { cameraEnabled } = useCamera();
  const { screenShareActive } = useScreenShare();
  const { isConnected } = useSFU();

  const hasVideo = cameraEnabled || screenShareActive || stats.inbound.length > 0;

  return (
    <DebugOverlay
      isVisible={isVisible}
      title="Video Debug"
      icon="📹"
      status={{
        active: isConnected && hasVideo,
        label: isConnected ? (hasVideo ? "Streaming" : "No video") : "Disconnected",
      }}
      initialPosition={{ x: window.innerWidth - 680, y: 10 }}
    >
      {/* Connection */}
      <div style={{ marginBottom: "8px" }}>
        <div style={sectionTitle}>Connection:</div>
        <div style={indent}>
          <div>RTT: {stats.connection.rttMs != null ? `${fmt(stats.connection.rttMs)} ms` : "—"}</div>
          <div>Avail out: {stats.connection.availableOutKbps != null ? `${fmtInt(stats.connection.availableOutKbps)} kbps` : "—"}</div>
          <div>Candidate: {stats.connection.candidateType ?? "—"} ({stats.connection.transportProtocol ?? "—"})</div>
        </div>
      </div>

      {/* Outbound */}
      {stats.outbound.length === 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={sectionTitle}>Outbound:</div>
          <div style={{ ...indent, color: "var(--gray-9)" }}>No outbound video</div>
        </div>
      )}
      {stats.outbound.map((s, i) => (
        <OutboundSection key={`out-${s.label}-${i}`} s={s} />
      ))}

      {/* Inbound */}
      {stats.inbound.length === 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={sectionTitle}>Inbound:</div>
          <div style={{ ...indent, color: "var(--gray-9)" }}>No inbound video</div>
        </div>
      )}
      {stats.inbound.map((s, i) => (
        <InboundSection key={`in-${s.trackId}-${i}`} s={s} index={i} />
      ))}
    </DebugOverlay>
  );
}
