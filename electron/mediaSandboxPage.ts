/// <reference lib="dom" />

/* Runs in the media sandbox window: a sandboxed renderer with no Node, no network and no
   storage. Untrusted pictures and videos are decoded here, never in the main process. */
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from "mediabunny";

import {
  buildAnimatedWebp,
  dominantColour,
  IMAGE_PROFILES,
  imageBox,
  MAX_ANIMATION_FRAMES,
  MAX_INPUT_PIXELS,
  MAX_MEDIA_BYTES,
  MAX_VIDEO_SECONDS,
  type MediaJob,
  type MediaResult,
  type MediaUse,
  place,
  sniffImage,
  VIDEO_BOXES,
  VIDEO_FPS,
  type VideoUse,
} from "./mediaSandboxFormat";

declare global {
  interface Window {
    grytMedia: {
      onJob(handler: (id: number, job: MediaJob) => void): void;
      done(id: number, result: MediaResult): void;
    };
  }
}

type Drawable = CanvasImageSource & { displayWidth?: number; displayHeight?: number };

function canvasFor(width: number, height: number): [OffscreenCanvas, OffscreenCanvasRenderingContext2D] {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("No 2D context");
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

async function blobBytes(canvas: OffscreenCanvas, type: string, quality: number): Promise<Uint8Array> {
  const blob = await canvas.convertToBlob({ type, quality });
  if (blob.type !== type) throw new Error(`The canvas could not write ${type}`);
  return new Uint8Array(await blob.arrayBuffer());
}

function drawInto(
  ctx: OffscreenCanvasRenderingContext2D,
  source: Drawable,
  srcW: number,
  srcH: number,
  fit: "cover" | "inside",
  width: number,
  height: number,
): void {
  const p = place(srcW, srcH, fit, width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, p.sx, p.sy, p.sw, p.sh, 0, 0, width, height);
}

async function thumbFrom(canvas: OffscreenCanvas, use: MediaUse): Promise<Uint8Array | null> {
  const thumb = IMAGE_PROFILES[use].thumb;
  if (!thumb) return null;
  const fit = thumb.height ? "cover" : "inside";
  const p = place(canvas.width, canvas.height, fit, thumb.width, thumb.height ?? Number.MAX_SAFE_INTEGER);
  const [out, ctx] = canvasFor(p.width, p.height);
  drawInto(ctx, canvas, canvas.width, canvas.height, fit, p.width, p.height);
  return blobBytes(out, "image/webp", 0.6);
}

function colourOf(canvas: OffscreenCanvas): string | null {
  const [, ctx] = canvasFor(32, 32);
  ctx.drawImage(canvas, 0, 0, 32, 32);
  return dominantColour(ctx.getImageData(0, 0, 32, 32).data);
}

async function image(use: MediaUse, bytes: Uint8Array): Promise<MediaResult> {
  const type = sniffImage(bytes);
  if (!type) return { ok: false, reason: "Not a picture this sandbox reads" };
  const profile = IMAGE_PROFILES[use];

  if (type === "image/gif" || type === "image/webp") {
    const decoder = new ImageDecoder({ data: bytes, type });
    try {
      await decoder.tracks.ready;
      await decoder.completed;
      const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
      if (count > 1) return await animation(use, decoder, Math.min(count, MAX_ANIMATION_FRAMES));
    } finally {
      decoder.close();
    }
  }

  // createImageBitmap turns a JPEG by its EXIF orientation, which ImageDecoder does not.
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), { imageOrientation: "from-image" });
  try {
    if (bitmap.width * bitmap.height > MAX_INPUT_PIXELS) return { ok: false, reason: "Picture is too large" };
    const box = imageBox(use, false);
    const p = place(bitmap.width, bitmap.height, profile.fit, box.width, box.height);
    const [canvas, ctx] = canvasFor(p.width, p.height);
    drawInto(ctx, bitmap, bitmap.width, bitmap.height, profile.fit, p.width, p.height);
    return {
      ok: true,
      kind: "image",
      body: await blobBytes(canvas, "image/webp", 0.8),
      mime: "image/webp",
      width: p.width,
      height: p.height,
      animated: false,
      thumb: await thumbFrom(canvas, use),
      thumbPx: profile.thumb?.width ?? null,
      colour: colourOf(canvas),
    };
  } finally {
    bitmap.close();
  }
}

async function animation(use: MediaUse, decoder: ImageDecoder, count: number): Promise<MediaResult> {
  const profile = IMAGE_PROFILES[use];
  const box = imageBox(use, true);
  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;
  let size: { width: number; height: number } | null = null;
  const frames: { webp: Uint8Array; durationMs: number }[] = [];
  let first: OffscreenCanvas | null = null;

  for (let i = 0; i < count; i++) {
    const { image: frame } = await decoder.decode({ frameIndex: i, completeFramesOnly: true });
    try {
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (w * h > MAX_INPUT_PIXELS) return { ok: false, reason: "Picture is too large" };
      // The output size is set by the first frame; a later frame that claims another size is drawn into it.
      if (!size) {
        const p = place(w, h, profile.fit, box.width, box.height);
        size = { width: p.width, height: p.height };
        [canvas, ctx] = canvasFor(size.width, size.height);
      }
      drawInto(ctx!, frame, w, h, profile.fit, size.width, size.height);
      frames.push({ webp: await blobBytes(canvas!, "image/webp", 0.75), durationMs: (frame.duration ?? 100_000) / 1000 });
      if (!first) {
        const [copy, copyCtx] = canvasFor(size.width, size.height);
        copyCtx.drawImage(canvas!, 0, 0);
        first = copy;
      }
    } finally {
      frame.close();
    }
  }

  return {
    ok: true,
    kind: "image",
    body: buildAnimatedWebp(frames, size!.width, size!.height),
    mime: "image/webp",
    width: size!.width,
    height: size!.height,
    animated: true,
    thumb: await thumbFrom(first!, use),
    thumbPx: profile.thumb?.width ?? null,
    colour: colourOf(first!),
  };
}

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
      reject(new Error("The video could not be decoded"));
    };
    video.addEventListener(event, done);
    video.addEventListener("error", fail);
  });
}

/* Every frame is drawn into one fixed size at a fixed rate, so a stream that changes size or
   timing part-way comes out as one plain clip. Sound is never read. */
async function video(use: VideoUse, bytes: Uint8Array): Promise<MediaResult> {
  const { width, height, bitrate } = VIDEO_BOXES[use];
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const el = document.createElement("video");
  el.muted = true;
  el.preload = "auto";
  try {
    const loaded = waitFor(el, "loadedmetadata");
    el.src = url;
    await loaded;
    if (!el.videoWidth || !el.videoHeight) return { ok: false, reason: "No picture in the video" };

    const [canvas, ctx] = canvasFor(width, height);
    const source = new CanvasSource(canvas, { codec: "av1", bitrate, keyFrameInterval: MAX_VIDEO_SECONDS, sizeChangeBehavior: "deny" });
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    output.addVideoTrack(source, { frameRate: VIDEO_FPS });
    await output.start();

    let poster: Uint8Array | null = null;
    const step = 1 / VIDEO_FPS;
    // A recording without a duration in its header reports Infinity; the ten-second cap still holds.
    const end = Math.min(MAX_VIDEO_SECONDS, Number.isFinite(el.duration) ? el.duration : MAX_VIDEO_SECONDS);
    let frames = 0;
    for (let t = 0; t < end - step / 2 && frames < MAX_VIDEO_SECONDS * VIDEO_FPS; t += step) {
      const seeked = waitFor(el, "seeked");
      el.currentTime = t;
      await seeked;
      if (el.ended && frames > 0) break;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      const p = place(el.videoWidth, el.videoHeight, "cover", width, height);
      ctx.drawImage(el, p.sx, p.sy, p.sw, p.sh, 0, 0, width, height);
      if (!poster) poster = await blobBytes(canvas, "image/jpeg", 0.8);
      await source.add(frames * step, step);
      frames++;
    }
    if (frames === 0 || !poster) return { ok: false, reason: "No frames in the video" };

    source.close();
    await output.finalize();
    if (!target.buffer) return { ok: false, reason: "The encoder wrote nothing" };
    return { ok: true, kind: "video", video: new Uint8Array(target.buffer), poster, width, height };
  } finally {
    el.removeAttribute("src");
    el.load();
    URL.revokeObjectURL(url);
  }
}

async function run(job: MediaJob): Promise<MediaResult> {
  if (!(job.bytes instanceof Uint8Array) || job.bytes.length === 0 || job.bytes.length > MAX_MEDIA_BYTES) {
    return { ok: false, reason: "File is empty or too large to process" };
  }
  if (job.kind === "image" && job.use in IMAGE_PROFILES) return image(job.use, job.bytes);
  if (job.kind === "video" && job.use in VIDEO_BOXES) return video(job.use, job.bytes);
  return { ok: false, reason: "Unknown job" };
}

window.grytMedia.onJob((id, job) => {
  run(job)
    .catch((err: unknown): MediaResult => ({ ok: false, reason: err instanceof Error ? err.message : String(err) }))
    .then((result) => window.grytMedia.done(id, result));
});
