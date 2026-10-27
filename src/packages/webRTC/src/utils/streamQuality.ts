import { CAMERA_FPS_OPTIONS, type CaptureQuality, estimateBitrate, QUALITY_CONSTRAINTS, type ScreenShareQuality, type VideoSendSettings } from "@gryt/voice";

/**
 * The in-call quality choices. Each one is a ceiling, not a fixed size: GRYT-1321's
 * allocator may send less than this to fit what viewers show, but never more.
 */
export interface QualityPreset {
  quality: CaptureQuality;
  fps: number;
  hint: string;
  name?: string;
}

export const SCREEN_PRESETS: QualityPreset[] = [
  { quality: "native", fps: 30, hint: "Sharpest text", name: "Sharp text" },
  { quality: "1080p", fps: 60, hint: "Smoothest motion", name: "Smooth" },
  { quality: "720p", fps: 30, hint: "Uses less data", name: "Less data" },
];

/** A screen preset as the picker and the share menu name it: "Smooth · 60". */
export function screenPresetName(quality: string, fps: number): string {
  const preset = SCREEN_PRESETS.find((p) => p.quality === quality && p.fps === fps);
  return `${preset?.name ?? "Your default"} · ${fps}`;
}

export const CAMERA_PRESETS: QualityPreset[] = [
  { quality: "native", fps: 30, hint: "Sharp" },
  { quality: "720p", fps: 30, hint: "Normal" },
  { quality: "360p", fps: 15, hint: "Saves data" },
];

/** The value the Custom row carries. Not a `quality@fps` pair, because Custom is not one. */
export const CUSTOM_KEY = "custom";

/** Every size the capture can be pinned to, widest first, as the Custom row lists them. */
export const CAMERA_QUALITY_ORDER: CaptureQuality[] = [
  "native", "4k", "1440p", "1080p", "720p", "480p", "360p", "240p",
  "144p", "96p", "64p", "48p", "32p", "24p", "16p", "8p", "4p",
];

export interface CameraCapabilities {
  /* Three separate maxima, not one mode: a camera listing both may manage only one at a
     time. Enough to advertise Native with, not to promise. */
  ceiling: { width: number; height: number; fps: number } | null;
  /** What the open track is producing. The truth, once Native is what opened it. */
  live: { width: number; height: number; fps: number } | null;
}

const NO_CAPABILITIES: CameraCapabilities = { ceiling: null, live: null };

/* Only a raw device track can be read; the flipped one is a canvas capture. The preview fills
   this in and the menu reads it back by device. */
const ceilings = new Map<string, CameraCapabilities["ceiling"]>();

/** The device ceiling whatever the current constraints are, so Native can speak while another
    preset is selected. Guarded: Firefox has shipped without `getCapabilities`. */
export function cameraCapabilities(
  track: MediaStreamTrack | null | undefined,
  deviceId?: string,
): CameraCapabilities {
  if (!track) return NO_CAPABILITIES;
  try {
    const s = track.getSettings();
    const live = s.width && s.height && s.frameRate
      ? { width: s.width, height: s.height, fps: s.frameRate }
      : null;
    // A canvas capture carries no deviceId. A camera does, and that is what makes it readable.
    if (s.deviceId && typeof track.getCapabilities === "function") {
      const c = track.getCapabilities();
      if (c.width?.max && c.height?.max && c.frameRate?.max) {
        const ceiling = { width: c.width.max, height: c.height.max, fps: c.frameRate.max };
        ceilings.set(s.deviceId, ceiling);
        return { ceiling, live };
      }
    }
    return { ceiling: (deviceId ? ceilings.get(deviceId) : null) ?? null, live };
  } catch {
    return NO_CAPABILITIES;
  }
}

/** Snapped to CAMERA_FPS_OPTIONS, the only six `CameraFps` and Settings know. The half frame
    matters: a Cam Link reports 59.94017791748047, and 30 without it (GRYT-1956). */
export function nativeFps(caps: CameraCapabilities): number {
  const max = caps.ceiling?.fps ?? caps.live?.fps;
  if (!max) return 30;
  const fits = CAMERA_FPS_OPTIONS.filter((f) => f <= max + 0.5);
  return fits[fits.length - 1] ?? CAMERA_FPS_OPTIONS[0];
}

/** Measured once Native opened the track; before that, the size and the rate `nativeFps` will
    ask for, which is not always the one reported. Null while no camera is open. */
export function nativeDetail(caps: CameraCapabilities, isLive: boolean): string | null {
  if (isLive && caps.live) return `${caps.live.width}\u00d7${caps.live.height}, ${Math.round(caps.live.fps)} fps`;
  const size = caps.ceiling ?? caps.live;
  return size ? `${size.width}\u00d7${size.height}, ${nativeFps(caps)} fps` : null;
}

/** What a camera preset is, under its name: "full, 30 fps". */
export function presetDetail(quality: string, fps: number): string {
  return `${quality === "native" ? "full" : quality}, ${fps} fps`;
}

export function presetKey(quality: string, fps: number): string {
  return `${quality}@${fps}`;
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
