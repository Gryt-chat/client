import { useCamera, useScreenShare, useSFU } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";

import { PiVideoCameraFill } from "../lib/icons";
import { DebugOverlay } from "./debugOverlay";
import {
  type ConnectionDiagnostics,
  type InboundDiagnostics,
  labelForTrack,
  type OutboundDiagnostics,
  readVideoStats,
  type SenderTracks,
  type Stat,
  type VideoLabel,
} from "./videoDebugStats";

interface VideoDebugOverlayProps {
  isVisible: boolean;
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

interface VideoDiagnostics {
  connectionState: RTCPeerConnectionState | null;
  iceConnectionState: RTCIceConnectionState | null;
  signalingState: RTCSignalingState | null;
  connection: ConnectionDiagnostics;
  senders: SenderDiagnostics[];
  outbound: OutboundDiagnostics[];
  inbound: InboundDiagnostics[];
}

const EMPTY_DIAGNOSTICS: VideoDiagnostics = {
  connectionState: null,
  iceConnectionState: null,
  signalingState: null,
  connection: {
    rttMs: null,
    availableOutKbps: null,
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
  inbound: [],
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

/** Room left under the overlay for the call controls along the bottom of the voice panel. */
const CALL_CONTROLS_CLEARANCE = 180;

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

function readSenders(pc: RTCPeerConnection, tracks: SenderTracks): SenderDiagnostics[] {
  return pc.getSenders()
    .filter((sender) => sender.track?.kind === "video")
    .map((sender) => {
      const track = sender.track;
      const settings = track?.getSettings();
      const encoding = sender.getParameters().encodings?.[0];

      return {
        label: labelForTrack(track?.id ?? null, tracks),
        trackId: track?.id ?? null,
        readyState: track?.readyState ?? null,
        enabled: track?.enabled ?? null,
        muted: track?.muted ?? null,
        width: settings?.width ?? null,
        height: settings?.height ?? null,
        frameRate: settings?.frameRate ?? null,
        encodingActive: typeof encoding?.active === "boolean" ? encoding.active : null,
        maxBitrateKbps:
          typeof encoding?.maxBitrate === "number" ? encoding.maxBitrate / 1000 : null,
      };
    });
}

function useVideoDebugDiagnostics(enabled: boolean): VideoDiagnostics {
  const sfu = useSFU();
  // useSFU hands out new getters every render, so the poll reads them here instead of restarting.
  const sfuRef = useRef(sfu);
  sfuRef.current = sfu;
  const [diagnostics, setDiagnostics] = useState<VideoDiagnostics>(EMPTY_DIAGNOSTICS);

  useEffect(() => {
    if (!enabled) {
      setDiagnostics(EMPTY_DIAGNOSTICS);
      return;
    }

    let cancelled = false;
    let polling = false;
    let lastPc: RTCPeerConnection | null = null;
    let samples: ReadonlyMap<string, Stat> = new Map();

    const poll = async () => {
      if (polling) return;
      const { getPeerConnection, getCameraSenderTrackId, getScreenSenderTrackId } = sfuRef.current;
      const pc = getPeerConnection?.() ?? null;
      if (pc !== lastPc) samples = new Map();
      lastPc = pc;
      if (!pc) {
        if (!cancelled) setDiagnostics(EMPTY_DIAGNOSTICS);
        return;
      }

      polling = true;
      try {
        const report = await pc.getStats();
        if (cancelled) return;
        const tracks: SenderTracks = {
          camera: getCameraSenderTrackId?.() ?? null,
          screen: getScreenSenderTrackId?.() ?? null,
        };
        const reading = readVideoStats(report.values() as Iterable<Stat>, samples, tracks);
        samples = reading.samples;
        setDiagnostics({
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          signalingState: pc.signalingState,
          connection: reading.connection,
          senders: readSenders(pc, tracks),
          outbound: reading.outbound,
          inbound: reading.inbound,
        });
      } catch {
        // getStats can race peer-connection shutdown.
      } finally {
        polling = false;
      }
    };

    void poll();
    const interval = setInterval(poll, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled]);

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

function OutboundSection({ s }: { s: OutboundDiagnostics }) {
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>Outbound — {labelTitle(s.label)}:</div>
      <div style={indent}>
        <div>Codec: {s.codec ?? "—"}</div>
        {s.codecFmtp && <div>Codec params: {s.codecFmtp}</div>}
        <div>Resolution: {resolution(s.frameWidth, s.frameHeight)}</div>
        <div>FPS: {fmt(s.framesPerSecond, 0)}</div>
        <div>Bitrate: {s.bitrateKbps != null ? `${fmt(s.bitrateKbps)} kbps` : "—"}</div>
        <div>Target: {s.targetBitrateKbps != null ? `${fmtInt(s.targetBitrateKbps)} kbps` : "—"}</div>
        <div>Packets sent: {fmtInt(s.packetsSent)}</div>
        <div>
          Retransmit: {fmtInt(s.retransmittedPacketsSent)} pkts /{" "}
          {fmtBytes(s.retransmittedBytesSent)}
        </div>
        <div>
          Send delay: {s.averagePacketSendDelayMs != null
            ? `${fmt(s.averagePacketSendDelayMs, 2)} ms/pkt`
            : "—"}
        </div>
        <div>Frames: {fmtInt(s.framesEncoded)} enc / {fmtInt(s.keyFramesEncoded)} key</div>
        <div>
          Encode:{" "}
          {s.averageEncodeTimeMs != null ? `${fmt(s.averageEncodeTimeMs, 2)} ms/frame avg` : "—"}
          {" / "}
          {s.totalEncodeTimeMs != null ? `${fmt(s.totalEncodeTimeMs)} ms total` : "—"}
        </div>
        <div>Avg QP: {fmt(s.averageQp, 1)}</div>
        <div>PLI: {fmtInt(s.pliCount)} / NACK: {fmtInt(s.nackCount)}</div>
        <div>
          Remote RTCP: RTT {s.remoteRttMs != null ? `${fmt(s.remoteRttMs)} ms` : "—"}
          {" / "}jitter {s.remoteJitterMs != null ? `${fmt(s.remoteJitterMs)} ms` : "—"}
        </div>
        <div>
          Remote loss: {s.remoteLossPct != null ? `${fmt(s.remoteLossPct, 2)}%` : "—"}
          {" / "}{fmtInt(s.remotePacketsLost)} pkts
          {" / "}{fmtInt(s.reportsReceived)} reports
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
          Limit time: bw {fmt(s.bandwidthLimitedSeconds, 1)}s / cpu{" "}
          {fmt(s.cpuLimitedSeconds, 1)}s / other{" "}
          {fmt(s.otherLimitedSeconds, 1)}s
        </div>
        <div>Resolution changes: {fmtInt(s.resolutionChanges)}</div>
        <div>SVC mode: {s.scalabilityMode ?? "—"}</div>
        <div>Encoder: {s.encoderImplementation ?? "—"}</div>
      </div>
    </div>
  );
}

function InboundSection({ s, index }: { s: InboundDiagnostics; index: number }) {
  const recentDropColor =
    s.recentDropPct != null && s.recentDropPct >= 2 ? "var(--gryt-warning-11)" : undefined;
  const recentLossColor =
    s.recentLossPct != null && s.recentLossPct >= 1 ? "var(--gryt-warning-11)" : undefined;

  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={sectionTitle}>Inbound #{index + 1}:</div>
      <div style={indent}>
        <div>Codec: {s.codec ?? "—"}</div>
        <div>Resolution: {resolution(s.frameWidth, s.frameHeight)}</div>
        <div>FPS: {fmt(s.framesPerSecond, 0)}</div>
        <div>Bitrate: {s.bitrateKbps != null ? `${fmt(s.bitrateKbps)} kbps` : "—"}</div>
        <div>Jitter: {s.jitterMs != null ? `${fmt(s.jitterMs)} ms` : "—"}</div>
        <div>
          Packets: {fmtInt(s.packetsReceived)} recv / {fmtInt(s.packetsLost)} lost /{" "}
          {fmtInt(s.packetsDiscarded)} discarded
        </div>
        <div style={{ color: recentLossColor }}>
          Recent loss:{" "}
          {s.recentLossPct != null ? `${fmt(s.recentLossPct, 2)}%` : "—"}
          {" / "}
          {fmt(s.recentPacketsReceivedPerSecond, 1)} recv/s
          {" / "}
          {fmt(s.recentPacketsLostPerSecond, 1)} lost/s
        </div>
        <div>
          Frames: {fmtInt(s.framesReceived)} recv / {fmtInt(s.framesDecoded)}{" "}
          decoded / {fmtInt(s.framesDropped)} dropped
        </div>
        <div style={{ color: recentDropColor }}>
          Recent drops:{" "}
          {s.recentDropPct != null ? `${fmt(s.recentDropPct, 1)}%` : "—"}
          {" / "}
          {fmt(s.recentDecodedFps, 1)} decoded/s
          {" / "}
          {fmt(s.recentDroppedFps, 1)} dropped/s
        </div>
        <div>
          Decode: {s.averageDecodeTimeMs != null
            ? `${fmt(s.averageDecodeTimeMs, 2)} ms/frame avg`
            : "—"}
        </div>
        <div>
          Processing: {s.averageProcessingDelayMs != null
            ? `${fmt(s.averageProcessingDelayMs, 2)} ms/frame avg`
            : "—"}
        </div>
        <div>
          Jitter buffer: {s.averageJitterBufferDelayMs != null
            ? `${fmt(s.averageJitterBufferDelayMs, 2)} ms/frame avg`
            : "—"}
        </div>
        <div>
          Assembly: {s.averageAssemblyTimeMs != null
            ? `${fmt(s.averageAssemblyTimeMs, 2)} ms/frame avg`
            : "—"}
          {" / "}
          {fmtInt(s.framesAssembledFromMultiplePackets)} multi-packet
        </div>
        <div>
          Freezes: {fmtInt(s.freezeCount)} /{" "}
          {s.totalFreezesDurationMs != null
            ? `${fmt(s.totalFreezesDurationMs / 1000, 1)}s total`
            : "—"}
        </div>
        <div>Decoder: {s.decoderImplementation ?? "—"}</div>
        <div>
          PLI: {fmtInt(s.pliCount)} (+{fmtInt(s.recentPliCount)}) / FIR:{" "}
          {fmtInt(s.firCount)} / NACK: {fmtInt(s.nackCount)} (+
          {fmtInt(s.recentNackCount)})
        </div>
      </div>
    </div>
  );
}

export function VideoDebugOverlay({ isVisible }: VideoDebugOverlayProps) {
  const diagnostics = useVideoDebugDiagnostics(isVisible);
  const { cameraEnabled } = useCamera();
  const { screenShareActive } = useScreenShare();
  const { isConnected } = useSFU();

  const { connection } = diagnostics;
  const hasVideo = cameraEnabled || screenShareActive || diagnostics.inbound.length > 0;
  const localPath = [connection.localCandidateType, connection.localNetworkType].filter(Boolean).join("/");

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
      <div style={{ maxHeight: `calc(100vh - ${CALL_CONTROLS_CLEARANCE}px)`, overflowY: "auto", paddingRight: "4px" }}>
        <div style={{ marginBottom: "8px" }}>
          <div style={sectionTitle}>Connection:</div>
          <div style={indent}>
            <div>RTT: {connection.rttMs != null ? `${fmt(connection.rttMs)} ms` : "—"}</div>
            <div>Avail out: {connection.availableOutKbps != null ? `${fmtInt(connection.availableOutKbps)} kbps` : "—"}</div>
            <div>Avail in: {connection.availableInKbps != null ? `${fmtInt(connection.availableInKbps)} kbps` : "—"}</div>
            <div>
              Path: {localPath || "—"} → {connection.remoteCandidateType ?? "—"} ({connection.protocol ?? "—"})
            </div>
            <div>
              States: {diagnostics.connectionState ?? "—"} / ICE{" "}
              {diagnostics.iceConnectionState ?? "—"} / signaling{" "}
              {diagnostics.signalingState ?? "—"}
            </div>
            <div>
              Send discarded: {fmtBytes(connection.bytesDiscardedOnSend)} /{" "}
              {fmtInt(connection.packetsDiscardedOnSend)} pkts
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

        {diagnostics.outbound.length === 0 && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>Outbound:</div>
            <div style={{ ...indent, color: "var(--gryt-neutral-9)" }}>No outbound video</div>
          </div>
        )}
        {diagnostics.outbound.map((s) => (
          <OutboundSection key={s.id} s={s} />
        ))}

        {diagnostics.inbound.length === 0 && (
          <div style={{ marginBottom: "8px" }}>
            <div style={sectionTitle}>Inbound:</div>
            <div style={{ ...indent, color: "var(--gryt-neutral-9)" }}>No inbound video</div>
          </div>
        )}
        {diagnostics.inbound.map((s, i) => (
          <InboundSection key={s.id} s={s} index={i} />
        ))}
      </div>
    </DebugOverlay>
  );
}
