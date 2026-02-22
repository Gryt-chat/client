import { Badge, Box, Flex, Text } from "@radix-ui/themes";

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
    <Flex justify="between" align="center" py="1">
      <Text size="1" color="gray">{label}</Text>
      <Text size="1" weight="medium" style={{ color: color || "inherit", fontFamily: "var(--code-font-family)" }}>
        {ms(value)}
      </Text>
    </Flex>
  );
}

function LatencyBar({ latency }: { latency: LatencyBreakdown }) {
  const segments: { label: string; ms: number; color: string }[] = [];

  if (latency.contextBaseLatencyMs !== null && latency.contextBaseLatencyMs > 0) {
    segments.push({ label: "Context", ms: latency.contextBaseLatencyMs, color: "var(--blue-9)" });
  }
  if (latency.rnnoiseBufferMs !== null && latency.rnnoiseBufferMs > 0) {
    segments.push({ label: "RNNoise", ms: latency.rnnoiseBufferMs, color: "var(--orange-9)" });
  }
  if (latency.oneWayNetworkMs !== null && latency.oneWayNetworkMs > 0) {
    segments.push({ label: "Network", ms: latency.oneWayNetworkMs, color: "var(--green-9)" });
  }
  if (latency.jitterBufferMs !== null && latency.jitterBufferMs > 0) {
    segments.push({ label: "Jitter buf", ms: latency.jitterBufferMs, color: "var(--purple-9)" });
  }

  const total = segments.reduce((sum, s) => sum + s.ms, 0);
  if (total === 0) return null;

  return (
    <Flex direction="column" gap="1">
      <Flex
        style={{
          height: "20px",
          borderRadius: "var(--radius-2)",
          overflow: "hidden",
          background: "var(--gray-4)",
        }}
      >
        {segments.map((seg) => (
          <Box
            key={seg.label}
            style={{
              width: `${(seg.ms / total) * 100}%`,
              minWidth: "2px",
              background: seg.color,
              transition: "width 0.3s ease",
            }}
          />
        ))}
      </Flex>
      <Flex gap="3" wrap="wrap">
        {segments.map((seg) => (
          <Flex key={seg.label} align="center" gap="1">
            <Box
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "var(--radius-1)",
                background: seg.color,
                flexShrink: 0,
              }}
            />
            <Text size="1" color="gray">
              {seg.label} {seg.ms.toFixed(1)}ms
            </Text>
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}

function ratingColor(estimatedMs: number | null): string {
  if (estimatedMs === null) return "var(--gray-11)";
  if (estimatedMs < 30) return "var(--green-11)";
  if (estimatedMs < 80) return "var(--blue-11)";
  if (estimatedMs < 150) return "var(--orange-11)";
  return "var(--red-11)";
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
    <Flex direction="column" gap="3">
      <Flex justify="between" align="center">
        <Text weight="medium" size="2">Voice Latency</Text>
        <Badge size="1" variant="surface">{modeLabel}</Badge>
      </Flex>

      {/* Estimated total with rating */}
      <Flex
        p="3"
        direction="column"
        gap="2"
        style={{
          background: "var(--gray-3)",
          borderRadius: "var(--radius-4)",
          border: "1px solid var(--gray-5)",
        }}
      >
        <Flex justify="between" align="center">
          <Text size="2" weight="bold">Estimated one-way</Text>
          <Flex align="center" gap="2">
            <Text
              size="3"
              weight="bold"
              style={{ color: ratingColor(latency.estimatedOneWayMs), fontFamily: "var(--code-font-family)" }}
            >
              {ms(latency.estimatedOneWayMs)}
            </Text>
            <Badge
              size="1"
              color={
                latency.estimatedOneWayMs === null ? "gray"
                  : latency.estimatedOneWayMs < 30 ? "green"
                    : latency.estimatedOneWayMs < 80 ? "blue"
                      : latency.estimatedOneWayMs < 150 ? "orange" : "red"
              }
            >
              {ratingLabel(latency.estimatedOneWayMs)}
            </Badge>
          </Flex>
        </Flex>

        <LatencyBar latency={latency} />
      </Flex>

      {/* Pipeline breakdown */}
      <Flex direction="column" gap="1">
        <Text size="1" weight="bold" color="gray">Local Pipeline</Text>
        <LatencyRow label="AudioContext base" value={latency.contextBaseLatencyMs} />
        <LatencyRow label="AudioContext output" value={latency.contextOutputLatencyMs} />
        <LatencyRow
          label="RNNoise buffer"
          value={latency.rnnoiseBufferMs}
          color={latency.rnnoiseBufferMs !== null && latency.rnnoiseBufferMs > 50 ? "var(--orange-11)" : undefined}
        />
        <LatencyRow label="Total pipeline" value={latency.localPipelineMs} />
      </Flex>

      {/* Network breakdown */}
      {hasNetworkData && (
        <Flex direction="column" gap="1">
          <Text size="1" weight="bold" color="gray">Network</Text>
          <LatencyRow label="RTT" value={latency.networkRttMs} />
          <LatencyRow label="One-way" value={latency.oneWayNetworkMs} />
          <LatencyRow
            label="Jitter"
            value={latency.jitterMs}
            color={latency.jitterMs !== null && latency.jitterMs > 20 ? "var(--orange-11)" : undefined}
          />
          <LatencyRow label="Jitter buffer" value={latency.jitterBufferMs} />
        </Flex>
      )}

      {/* Connection info */}
      {hasNetworkData && (latency.sfuEndpoint || latency.remoteAddress) && (
        <Flex direction="column" gap="1">
          <Text size="1" weight="bold" color="gray">Connection</Text>
          {latency.sfuEndpoint && (
            <Flex justify="between" align="center" py="1">
              <Text size="1" color="gray">SFU endpoint</Text>
              <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>
                {latency.sfuEndpoint.replace(/^wss?:\/\//, "")}
              </Text>
            </Flex>
          )}
          {latency.remoteAddress && (
            <Flex justify="between" align="center" py="1">
              <Text size="1" color="gray">ICE remote</Text>
              <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)" }}>
                {latency.remoteAddress}
              </Text>
            </Flex>
          )}
          {latency.localAddress && (
            <Flex justify="between" align="center" py="1">
              <Text size="1" color="gray">ICE local</Text>
              <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)" }}>
                {latency.localAddress}
              </Text>
            </Flex>
          )}
          {latency.candidateType && (
            <Flex justify="between" align="center" py="1">
              <Text size="1" color="gray">Candidate type</Text>
              <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)" }}>
                {latency.candidateType}
              </Text>
            </Flex>
          )}
        </Flex>
      )}

      {/* Transport stats */}
      {hasNetworkData && (
        <Flex direction="column" gap="1">
          <Text size="1" weight="bold" color="gray">Transport</Text>
          <Flex justify="between" align="center" py="1">
            <Text size="1" color="gray">Codec</Text>
            <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.codec || "—"}
            </Text>
          </Flex>
          <Flex justify="between" align="center" py="1">
            <Text size="1" color="gray">Bitrate</Text>
            <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.bitrateKbps !== null ? `${latency.bitrateKbps.toFixed(1)} kbps` : "—"}
            </Text>
          </Flex>
          <Flex justify="between" align="center" py="1">
            <Text size="1" color="gray">Available out</Text>
            <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.availableOutKbps !== null ? `${Math.round(latency.availableOutKbps)} kbps` : "—"}
            </Text>
          </Flex>
          <Flex justify="between" align="center" py="1">
            <Text size="1" color="gray">Packets sent / recv</Text>
            <Text size="1" weight="medium" style={{ fontFamily: "var(--code-font-family)" }}>
              {latency.packetsSent ?? "—"} / {latency.packetsReceived ?? "—"}
            </Text>
          </Flex>
          <Flex justify="between" align="center" py="1">
            <Text size="1" color="gray">Packets lost</Text>
            <Text
              size="1"
              weight="medium"
              style={{
                fontFamily: "var(--code-font-family)",
                color: latency.packetsLost !== null && latency.packetsLost > 0 ? "var(--red-11)" : undefined,
              }}
            >
              {latency.packetsLost ?? "—"}
            </Text>
          </Flex>
        </Flex>
      )}

      {!hasNetworkData && (
        <Text size="1" color="gray">
          Connect to a voice channel to see network latency metrics.
        </Text>
      )}
    </Flex>
  );
}
