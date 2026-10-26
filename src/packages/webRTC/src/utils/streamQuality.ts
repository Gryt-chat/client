import { type CaptureQuality, estimateBitrate, QUALITY_CONSTRAINTS, type ScreenShareQuality, type VideoSendSettings } from "@gryt/voice";

/**
 * The in-call quality choices. Each one is a ceiling, not a fixed size: GRYT-1321's
 * allocator may send less than this to fit what viewers show, but never more.
 */
export interface QualityPreset {
  quality: CaptureQuality;
  fps: number;
  hint: string;
}

export const SCREEN_PRESETS: QualityPreset[] = [
  { quality: "native", fps: 30, hint: "Sharpest text" },
  { quality: "1080p", fps: 60, hint: "Smoothest motion" },
  { quality: "720p", fps: 30, hint: "Uses less data" },
];

export const CAMERA_PRESETS: QualityPreset[] = [
  { quality: "native", fps: 30, hint: "Sharp" },
  { quality: "720p", fps: 30, hint: "Normal" },
  { quality: "360p", fps: 15, hint: "Saves data" },
];

/** What a camera preset is, under its name: "full, 30 fps". */
export function presetDetail(quality: string, fps: number): string {
  return `${quality === "native" ? "full" : quality}, ${fps} fps`;
}

export function presetKey(quality: string, fps: number): string {
  return `${quality}@${fps}`;
}

export function presetLabel(quality: string, fps: number): string {
  const name = ({ native: "Native", "4k": "4K" } as Record<string, string>)[quality] ?? quality;
  return `${name} · ${fps} fps`;
}

/** The size box a quality caps at, or null for native, which has none. */
export function qualityBox(quality: string): { maxWidth: number; maxHeight: number } | null {
  const c = QUALITY_CONSTRAINTS[quality as CaptureQuality];
  return c?.width && c.height ? { maxWidth: c.width, maxHeight: c.height } : null;
}

/**
 * Widens the capture when the new ceiling is above what it was opened at. Lowering is left to
 * the encoder, so going back up never has to reopen anything. Best effort, like the engine's.
 */
export async function liftScreenCapture(track: MediaStreamTrack, quality: string, fps: number): Promise<void> {
  const current = track.getConstraints();
  const capHeight = maxOf(current.height);
  const capFps = maxOf(current.frameRate);
  const box = qualityBox(quality);
  const needsSize = capHeight !== null && (!box || box.maxHeight > capHeight);
  const needsFps = capFps !== null && fps > capFps;
  if (!needsSize && !needsFps) return;
  const next: MediaTrackConstraints = { frameRate: { ideal: fps, max: fps } };
  if (box) {
    next.width = { ideal: box.maxWidth, max: box.maxWidth };
    next.height = { ideal: box.maxHeight, max: box.maxHeight };
  }
  try {
    await track.applyConstraints(next);
  } catch (err) {
    console.warn("[ScreenShare] could not widen the capture for a higher ceiling", err);
  }
}

function maxOf(c: ConstrainULong | ConstrainDouble | undefined): number | null {
  if (typeof c === "object" && c && typeof c.max === "number") return c.max;
  return null;
}

/** What a shared window's sender is told, from the screen share settings. Every window gets its own. */
export function screenSendSettings(o: {
  quality: string;
  fps: number;
  gamingMode: boolean;
  codec: string | undefined;
  maxBitrate: number;
  scalabilityMode: string;
  /** Frames the native encoder made are injected past the encoder, so viewers can't size them (GRYT-1436). */
  nativeH264: boolean;
}): VideoSendSettings {
  let bitrate: number | null;
  if (o.maxBitrate > 0) bitrate = o.maxBitrate;
  else {
    bitrate = estimateBitrate(o.quality as ScreenShareQuality, o.fps);
    if (bitrate && o.gamingMode) bitrate = Math.min(Math.round(bitrate * 1.5), 50_000_000);
  }
  const box = qualityBox(o.quality);
  const isH264 = o.codec === "h264" || (!o.codec || o.codec === "auto");
  return {
    priority: "high",
    maxBitrate: bitrate ?? 50_000_000,
    maxFramerate: o.fps,
    maxSize: box ? { width: box.maxWidth, height: box.maxHeight } : null,
    degradationPreference: o.gamingMode ? "maintain-framerate" : "maintain-resolution",
    scalabilityMode: !isH264 && o.scalabilityMode !== "L1T1" ? o.scalabilityMode : undefined,
    followDemand: !o.nativeH264,
  };
}
