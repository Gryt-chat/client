import { Chip } from "@gryt/ui";

import type { LatencyBreakdown } from "@/audio";
import { useVoiceLatency } from "@/audio";

function ms(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)} ms`;
}

function LatencyRow({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color?: string;
}) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-xs text-gryt-muted">{label}</span>
      <span className="text-xs font-medium" style={{ color: color || "inherit", fontFamily: "var(--code-font-family)" }}>
        {ms(value)}
      </span>
    </div>
  );
}

function LatencyBar({ latency }: { latency: LatencyBreakdown }) {
  const segments: { label: string; ms: number; color: string }[] = [];

  if (latency.contextBaseLatencyMs !== null && latency.contextBaseLatencyMs > 0) {
    segments.push({ label: "Context", ms: latency.contextBaseLatencyMs, color: "var(--gryt-secondary-9)" });
  }
  if (latency.rnnoiseBufferMs !== null && latency.rnnoiseBufferMs > 0) {
    segments.push({ label: "RNNoise", ms: latency.rnnoiseBufferMs, color: "var(--gryt-warning-9)" });
  }
  if (latency.oneWayNetworkMs !== null && latency.oneWayNetworkMs > 0) {
    segments.push({ label: "Network", ms: latency.oneWayNetworkMs, color: "var(--gryt-success-9)" });
  }

  const total = segments.reduce((sum, s) => sum + s.ms, 0);
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex" style={{
          height: "20px",
          borderRadius: "var(--gryt-radius-sm)",
          overflow: "hidden",
          background: "var(--gryt-neutral-4)",
        }}>
        {segments.map((seg) => (
          <div key={seg.label} style={{
              width: `${(seg.ms / total) * 100}%`,
              minWidth: "2px",
              background: seg.color,
              transition: "width 0.3s ease",
            }} />
        ))}
      </div>
      <div className="flex gap-3 flex-wrap">
        {segments.map((seg) => (
          <div className="flex items-center gap-1" key={seg.label}>
            <div style={{
                width: "8px",
                height: "8px",
                borderRadius: "var(--gryt-radius-sm)",
                background: seg.color,
                flexShrink: 0,
              }} />
            <span className="text-xs text-gryt-muted">
              {seg.label} {seg.ms.toFixed(1)}ms
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ratingColor(estimatedMs: number | null): string {
  if (estimatedMs === null) return "var(--gryt-neutral-11)";
  if (estimatedMs < 30) return "var(--gryt-success-11)";
  if (estimatedMs < 80) return "var(--gryt-secondary-11)";
  if (estimatedMs < 150) return "var(--gryt-warning-11)";
  return "var(--gryt-danger-11)";
}

function ratingLabel(estimatedMs: number | null): string {
  if (estimatedMs === null) return "No data";
  if (estimatedMs < 30) return "Excellent";
  if (estimatedMs < 80) return "Good";
  if (estimatedMs < 150) return "Fair";
  return "Poor";
}

export function LatencyPanel() {
  const { latency, modeLabel } = useVoiceLatency(true);

  const hasNetworkData = latency.networkRttMs !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="font-medium text-sm">Voice Latency</span>
        <Chip tone="neutral">{modeLabel}</Chip>
      </div>

      {/* Estimated total with rating */}
      <div className="flex p-3 flex-col gap-2" style={{
          background: "var(--gryt-neutral-3)",
          borderRadius: "var(--gryt-radius-md)",
          border: "1px solid var(--gryt-neutral-5)",
        }}>
        <div className="flex justify-between items-center">
          <span className="text-sm font-bold">Estimated one-way</span>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold" style={{ color: ratingColor(latency.estimatedOneWayMs), fontFamily: "var(--code-font-family)" }}>
              {ms(latency.estimatedOneWayMs)}
            </span>
            <Chip tone="neutral"
              color={
                latency.estimatedOneWayMs === null ? "gray"
                  : latency.estimatedOneWayMs < 30 ? "green"
                    : latency.estimatedOneWayMs < 80 ? "blue"
                      : latency.estimatedOneWayMs < 150 ? "orange" : "red"
              }
            >
              {ratingLabel(latency.estimatedOneWayMs)}
            </Chip>
          </div>
        </div>

        <LatencyBar latency={latency} />
      </div>

      {/* Pipeline breakdown */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-gryt-muted">Local Pipeline</span>
        <LatencyRow label="AudioContext base" value={latency.contextBaseLatencyMs} />
        <LatencyRow label="AudioContext output" value={latency.contextOutputLatencyMs} />
        <LatencyRow
          label="RNNoise buffer"
          value={latency.rnnoiseBufferMs}
          color={latency.rnnoiseBufferMs !== null && latency.rnnoiseBufferMs > 50 ? "var(--gryt-warning-11)" : undefined}
        />
        <LatencyRow label="Total pipeline" value={latency.localPipelineMs} />
      </div>

      {/* Network breakdown */}
      {hasNetworkData && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-gryt-muted">Network</span>
          <LatencyRow label="RTT" value={latency.networkRttMs} />
          <LatencyRow label="One-way" value={latency.oneWayNetworkMs} />
          <LatencyRow
            label="Jitter"
            value={latency.jitterMs}
            color={latency.jitterMs !== null && latency.jitterMs > 20 ? "var(--gryt-warning-11)" : undefined}
          />
          <LatencyRow
            label="Jitter buffer"
            value={latency.jitterBufferMs}
            color={latency.jitterBufferMs !== null && latency.jitterBufferMs > 80 ? "var(--gryt-warning-11)" : undefined}
          />
        </div>
      )}

      {/* Connection info */}
      {hasNetworkData && (latency.sfuEndpoint || latency.remoteAddress) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-gryt-muted">Connection</span>
          {latency.sfuEndpoint && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-gryt-muted">SFU endpoint</span>
              <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                {latency.sfuEndpoint.replace(/^wss?:\/\//, "")}
              </span>
            </div>
          )}
          {latency.remoteAddress && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-gryt-muted">ICE remote</span>
              <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
                {latency.remoteAddress}
              </span>
            </div>
          )}
          {latency.localAddress && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-gryt-muted">ICE local</span>
              <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
                {latency.localAddress}
              </span>
            </div>
          )}
          {latency.candidateType && (
            <div className="flex justify-between items-center py-1">
              <span className="text-xs text-gryt-muted">Candidate type</span>
              <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
                {latency.candidateType}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Transport stats */}
      {hasNetworkData && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold text-gryt-muted">Transport</span>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">Codec</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.codec || "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">Bitrate</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.bitrateKbps !== null ? `${latency.bitrateKbps.toFixed(1)} kbps` : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">Available out</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.availableOutKbps !== null ? `${Math.round(latency.availableOutKbps)} kbps` : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">Packets sent / recv</span>
            <span className="text-xs font-medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.packetsSent ?? "—"} / {latency.packetsReceived ?? "—"}
            </span>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-xs text-gryt-muted">Packets lost</span>
            <span className="text-xs font-medium" style={{
                fontFamily: "var(--code-font-family)",
                color: latency.packetsLost !== null && latency.packetsLost > 0 ? "var(--gryt-danger-11)" : undefined,
              }}>
              {latency.packetsLost ?? "—"}
            </span>
          </div>
        </div>
      )}

      {!hasNetworkData && (
        <span className="text-xs text-gryt-muted">
          Connect to a voice channel to see network latency metrics.
        </span>
      )}
    </div>
  );
}
