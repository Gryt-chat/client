/* What the desktop media sandbox makes, shared by the main process, the sandboxed page and the
   checks. Mirrors the image worker's profiles, so a desktop server stores what a Docker one does. */

export type MediaUse = "upload" | "banner" | "avatar" | "emoji";
export type VideoUse = "banner" | "avatar";

export interface ImageProfile {
  fit: "cover" | "inside";
  width: number;
  height: number;
  /** Animated pictures are capped harder, since every frame is stored. */
  animatedMax: number;
  thumb: { width: number; height?: number } | null;
}

export const IMAGE_PROFILES: Record<MediaUse, ImageProfile> = {
  upload: { fit: "inside", width: 4096, height: 4096, animatedMax: 1024, thumb: { width: 320 } },
  banner: { fit: "cover", width: 960, height: 492, animatedMax: 960, thumb: { width: 480, height: 246 } },
  avatar: { fit: "cover", width: 256, height: 256, animatedMax: 256, thumb: { width: 128, height: 128 } },
  emoji: { fit: "inside", width: 128, height: 128, animatedMax: 128, thumb: null },
};

export const VIDEO_BOXES: Record<VideoUse, { width: number; height: number; bitrate: number }> = {
  banner: { width: 960, height: 492, bitrate: 450_000 },
  avatar: { width: 256, height: 256, bitrate: 120_000 },
};

export const VIDEO_FPS = 24;
export const MAX_VIDEO_SECONDS = 10;
export const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 100_000_000;
export const MAX_ANIMATION_FRAMES = 1000;

export type MediaJob =
  | { kind: "image"; use: MediaUse; bytes: Uint8Array }
  | { kind: "video"; use: VideoUse; bytes: Uint8Array };

export type MediaResult =
  | {
      ok: true;
      kind: "image";
      body: Uint8Array;
      mime: "image/webp";
      width: number;
      height: number;
      animated: boolean;
      thumb: Uint8Array | null;
      thumbPx: number | null;
      /** #rrggbb, or null when the picture has no readable colour. */
      colour: string | null;
    }
  | { ok: true; kind: "video"; video: Uint8Array; poster: Uint8Array; width: number; height: number }
  | { ok: false; reason: string };

const USES = new Set<string>(["upload", "banner", "avatar", "emoji"]);

/** A job from the image worker, checked field by field: the worker is the side that read the upload. */
export function parseMediaRequest(message: unknown): { id: number; job: MediaJob } | null {
  if (!message || typeof message !== "object") return null;
  const m = message as { type?: unknown; id?: unknown; job?: unknown };
  if (m.type !== "gryt-media-job" || typeof m.id !== "number" || !Number.isSafeInteger(m.id)) return null;
  const job = m.job as { kind?: unknown; use?: unknown; bytes?: unknown } | null;
  if (!job || typeof job !== "object" || !(job.bytes instanceof Uint8Array)) return null;
  if (job.kind === "image" && typeof job.use === "string" && USES.has(job.use)) {
    return { id: m.id, job: { kind: "image", use: job.use as MediaUse, bytes: job.bytes } };
  }
  if (job.kind === "video" && (job.use === "banner" || job.use === "avatar")) {
    return { id: m.id, job: { kind: "video", use: job.use, bytes: job.bytes } };
  }
  return null;
}

export type ImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/avif";

/** The type from the bytes, never from what the uploader said it was. */
export function sniffImage(b: Uint8Array): ImageType | null {
  const ascii = (at: number, s: string) => s.split("").every((c, i) => b[at + i] === c.charCodeAt(0));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (b.length >= 12 && ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis"))) return "image/avif";
  return null;
}

export interface Placement {
  /** The output picture. */
  width: number;
  height: number;
  /** The part of the source drawn into it. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Cover crops to fill the box exactly; inside shrinks to fit and never enlarges. */
export function place(srcW: number, srcH: number, fit: "cover" | "inside", boxW: number, boxH: number): Placement {
  if (fit === "cover") {
    const scale = Math.max(boxW / srcW, boxH / srcH);
    const sw = Math.min(srcW, boxW / scale);
    const sh = Math.min(srcH, boxH / scale);
    return { width: boxW, height: boxH, sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
  }
  const scale = Math.min(1, boxW / srcW, boxH / srcH);
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
    sx: 0,
    sy: 0,
    sw: srcW,
    sh: srcH,
  };
}

/** The box for one use, with the animated cap applied. */
export function imageBox(use: MediaUse, animated: boolean): { width: number; height: number } {
  const p = IMAGE_PROFILES[use];
  if (!animated) return { width: p.width, height: p.height };
  return { width: Math.min(p.width, p.animatedMax), height: Math.min(p.height, p.animatedMax) };
}

interface Chunk {
  fourcc: string;
  data: Uint8Array;
}

function readChunks(webp: Uint8Array): Chunk[] {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const tag = (at: number) => String.fromCharCode(webp[at], webp[at + 1], webp[at + 2], webp[at + 3]);
  if (webp.length < 12 || tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("Not a WebP");
  const chunks: Chunk[] = [];
  let at = 12;
  while (at + 8 <= webp.length) {
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > webp.length) throw new Error("Truncated WebP chunk");
    chunks.push({ fourcc: tag(at), data: webp.subarray(at + 8, at + 8 + size) });
    at += 8 + size + (size & 1);
  }
  return chunks;
}

function chunkBytes(fourcc: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + data.length + (data.length & 1));
  for (let i = 0; i < 4; i++) out[i] = fourcc.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function u24(out: Uint8Array, at: number, value: number): void {
  out[at] = value & 0xff;
  out[at + 1] = (value >> 8) & 0xff;
  out[at + 2] = (value >> 16) & 0xff;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/* Chromium's canvas writes still WebP only, so an animation is put together from one still per
   frame. Every frame covers the whole canvas and replaces the last, so nothing blends or disposes. */
export function buildAnimatedWebp(
  frames: { webp: Uint8Array; durationMs: number }[],
  width: number,
  height: number,
): Uint8Array {
  if (frames.length === 0) throw new Error("No frames");
  let alpha = false;
  const anmf = frames.map(({ webp, durationMs }) => {
    const image = readChunks(webp).filter((c) => c.fourcc === "ALPH" || c.fourcc === "VP8 " || c.fourcc === "VP8L");
    if (!image.some((c) => c.fourcc === "VP8 " || c.fourcc === "VP8L")) throw new Error("Frame has no image data");
    if (image.some((c) => c.fourcc === "ALPH" || c.fourcc === "VP8L")) alpha = true;
    const header = new Uint8Array(16);
    u24(header, 6, width - 1);
    u24(header, 9, height - 1);
    u24(header, 12, Math.min(0xffffff, Math.max(1, Math.round(durationMs))));
    header[15] = 0b10;
    return chunkBytes("ANMF", concat([header, ...image.map((c) => chunkBytes(c.fourcc, c.data))]));
  });

  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | (alpha ? 0x10 : 0);
  u24(vp8x, 4, width - 1);
  u24(vp8x, 7, height - 1);
  // Background colour zero and loop forever.
  const anim = new Uint8Array(6);

  const body = concat([new TextEncoder().encode("WEBP"), chunkBytes("VP8X", vp8x), chunkBytes("ANIM", anim), ...anmf]);
  const riff = new Uint8Array(8);
  riff.set(new TextEncoder().encode("RIFF"));
  new DataView(riff.buffer).setUint32(4, body.length, true);
  return concat([riff, body]);
}

/** The commonest colour, in 4-bit-per-channel buckets, from a small RGBA sample. */
export function dominantColour(rgba: Uint8ClampedArray | Uint8Array): string | null {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const bucket = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += rgba[i];
    bucket.g += rgba[i + 1];
    bucket.b += rgba[i + 2];
    counts.set(key, bucket);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of counts.values()) if (!best || bucket.n > best.n) best = bucket;
  if (!best) return null;
  const hex = (v: number) => Math.round(v / best.n).toString(16).padStart(2, "0");
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`;
}
