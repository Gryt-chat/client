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

type EncodingWithDownTo = RTCRtpEncodingParameters & {
  scaleResolutionDownTo?: { maxWidth: number; maxHeight: number };
};

/**
 * The size ceiling on the encoder. scaleResolutionDownTo follows the source as it resizes, and a
 * browser without it gets the same box as a divisor worked out from the track now.
 */
export function setSizeCeiling(
  encoding: RTCRtpEncodingParameters,
  box: { maxWidth: number; maxHeight: number } | null,
  track: MediaStreamTrack,
  hasDownTo: boolean,
): void {
  const enc = encoding as EncodingWithDownTo;
  if (hasDownTo) {
    delete enc.scaleResolutionDownBy;
    if (box) enc.scaleResolutionDownTo = box;
    else delete enc.scaleResolutionDownTo;
    return;
  }
  const s = track.getSettings();
  enc.scaleResolutionDownBy = box
    ? Math.max(1, (s.width ?? 0) / box.maxWidth, (s.height ?? 0) / box.maxHeight)
    : 1;
}

let downToSupport: boolean | null = null;

/** Whether this browser keeps scaleResolutionDownTo. Electron 40 and Chrome 153 do, measured. */
export async function supportsDownTo(sender: RTCRtpSender): Promise<boolean> {
  if (downToSupport !== null) return downToSupport;
  const params = sender.getParameters();
  const enc = params.encodings?.[0] as EncodingWithDownTo | undefined;
  if (!enc) return false;
  const before = enc.scaleResolutionDownTo;
  enc.scaleResolutionDownTo = before ?? { maxWidth: 7680, maxHeight: 4320 };
  try {
    await sender.setParameters(params);
    downToSupport = !!(sender.getParameters().encodings?.[0] as EncodingWithDownTo | undefined)?.scaleResolutionDownTo;
  } catch {
    downToSupport = false;
  }
  return downToSupport;
}
