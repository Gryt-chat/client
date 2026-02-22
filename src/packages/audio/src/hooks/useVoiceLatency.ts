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
  localPipelineMs: null,
  estimatedOneWayMs: null,
  estimatedRoundTripMs: null,
};

export function useVoiceLatency(enabled: boolean) {
  const { rnnoiseEnabled, eSportsModeEnabled, inputMode } = useSettings();
  const { getPeerConnection, isConnected } = useSFU();
  const { audioContext, microphoneBuffer } = useMicrophone(false);

  const [latency, setLatency] = useState<LatencyBreakdown>(EMPTY);
  const prevBytesRef = useRef<{ bytes: number; ts: number } | null>(null);

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

      const pc = getPeerConnection?.();
      if (pc && isConnected) {
        try {
          const report = await pc.getStats();
          const codecMap = new Map<string, string>();

          report.forEach((stat) => {
            if (stat.type === "codec") {
              codecMap.set(stat.id, (stat as { mimeType?: string }).mimeType || "unknown");
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
              if (typeof stat.jitterBufferDelay === "number" && typeof stat.jitterBufferEmittedCount === "number" && stat.jitterBufferEmittedCount > 0) {
                jitterBufferMs = (stat.jitterBufferDelay / stat.jitterBufferEmittedCount) * 1000;
              }
              if (stat.codecId && codecMap.has(stat.codecId)) {
                codec = codecMap.get(stat.codecId) || null;
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

      // Estimated one-way: my pipeline + half-RTT + their jitter buffer
      let estimatedOneWayMs: number | null = null;
      {
        let sum = 0;
        let hasData = false;
        if (local.totalMs !== null) { sum += local.totalMs; hasData = true; }
        if (oneWayNetworkMs !== null) { sum += oneWayNetworkMs; hasData = true; }
        if (jitterBufferMs !== null) { sum += jitterBufferMs; hasData = true; }
        estimatedOneWayMs = hasData ? sum : null;
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
    };
  }, [enabled, computeLocalPipeline, getPeerConnection, isConnected]);

  const modeLabel = eSportsModeEnabled
    ? "eSports"
    : inputMode === "push_to_talk"
      ? "Push to Talk"
      : "Voice Activity";

  return { latency, modeLabel };
}
