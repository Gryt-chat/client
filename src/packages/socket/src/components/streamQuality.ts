import type { InboundDiagnostics } from "../../../../components/videoDebugStats.ts";

/** The usual name for a stream's height. A window share is rarely exact, so 1032 reads as 1080p. */
export function resolutionLabel(height: number): string {
  if (height >= 2000) return "4K";
  if (height >= 1300) return "1440p";
  if (height >= 1000) return "1080p";
  if (height >= 650) return "720p";
  if (height >= 420) return "480p";
  return `${height}p`;
}

export interface QualityPill {
  resolution: string;
  fps: string;
}

/** Null until the first frames are in, so the pill never shows a blank. */
export function qualityPill(s: InboundDiagnostics | undefined): QualityPill | null {
  if (!s?.frameHeight || s.framesPerSecond == null) return null;
  return { resolution: resolutionLabel(s.frameHeight), fps: `${Math.round(s.framesPerSecond)} fps` };
}

const pct = (v: number | null) => (v == null ? "–" : `${v < 10 ? v.toFixed(1) : Math.round(v)}%`);

export function qualityDetails(s: InboundDiagnostics): [string, string][] {
  const rows: [string, string][] = [];
  if (s.frameWidth && s.frameHeight) {
    rows.push(["Size", `${s.frameWidth} × ${s.frameHeight}`]);
  }
  if (s.framesPerSecond != null) rows.push(["Frame rate", `${Math.round(s.framesPerSecond)} fps`]);
  if (s.codec) rows.push(["Codec", s.codec.replace(/^video\//i, "")]);
  if (s.bitrateKbps != null) {
    rows.push(["Bitrate", s.bitrateKbps >= 1000 ? `${(s.bitrateKbps / 1000).toFixed(1)} Mbit/s` : `${Math.round(s.bitrateKbps)} kbit/s`]);
  }
  rows.push(["Packet loss", pct(s.recentLossPct)]);
  rows.push(["Dropped frames", pct(s.recentDropPct)]);
  if (s.jitterMs != null) rows.push(["Jitter", `${Math.round(s.jitterMs)} ms`]);
  if (s.freezeCount != null) rows.push(["Freezes", s.freezeCount === 0 ? "none" : String(s.freezeCount)]);
  return rows;
}
