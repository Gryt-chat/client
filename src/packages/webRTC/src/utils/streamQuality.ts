import { type CaptureQuality, QUALITY_CONSTRAINTS } from "@gryt/voice";

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
  { quality: "native", fps: 30, hint: "Sharpest" },
  { quality: "720p", fps: 30, hint: "HD" },
  { quality: "360p", fps: 15, hint: "Uses less data" },
];

export function presetKey(quality: string, fps: number): string {
  return `${quality}@${fps}`;
}

export function presetLabel(quality: string, fps: number): string {
  return `${quality === "native" ? "Native" : quality === "4k" ? "4K" : quality} · ${fps} fps`;
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
