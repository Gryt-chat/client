/* The banner box: the card's 320 by 164 at 3x, the same box the server and media worker use. */
export const BANNER_W = 960;
export const BANNER_H = 492;
export const MAX_ZOOM = 4;

/** Where the picture sits in the frame: zoom over "cover", and the top-left corner in frame pixels. */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

/** The scale at which the picture just covers a frame of this size. */
export function coverScale(imgW: number, imgH: number, frameW: number, frameH: number): number {
  return Math.max(frameW / imgW, frameH / imgH);
}

/** Keeps the picture over the whole frame: zoom at least 1, and no edge pulled inside. */
export function clampCrop(c: Crop, imgW: number, imgH: number, frameW: number, frameH: number): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, c.zoom));
  const s = coverScale(imgW, imgH, frameW, frameH) * zoom;
  return {
    zoom,
    x: Math.min(0, Math.max(frameW - imgW * s, c.x)),
    y: Math.min(0, Math.max(frameH - imgH * s, c.y)),
  };
}

/** Centred at cover. */
export function initialCrop(imgW: number, imgH: number, frameW: number, frameH: number): Crop {
  const s = coverScale(imgW, imgH, frameW, frameH);
  return { zoom: 1, x: (frameW - imgW * s) / 2, y: (frameH - imgH * s) / 2 };
}

/** Zooms about a point in the frame, so what is under the cursor stays under it. */
export function zoomAbout(
  c: Crop, nextZoom: number, px: number, py: number,
  imgW: number, imgH: number, frameW: number, frameH: number,
): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
  const k = zoom / c.zoom;
  return clampCrop({ zoom, x: px - (px - c.x) * k, y: py - (py - c.y) * k }, imgW, imgH, frameW, frameH);
}

/** The part of the source picture the frame shows, in source pixels. */
export function sourceRect(c: Crop, imgW: number, imgH: number, frameW: number, frameH: number) {
  const s = coverScale(imgW, imgH, frameW, frameH) * c.zoom;
  return { sx: -c.x / s, sy: -c.y / s, sw: frameW / s, sh: frameH / s };
}

/** PNG, JPEG and still WebP get cropped; GIFs, animated WebP and video go up as they are. */
export async function isStillPicture(file: File): Promise<boolean> {
  if (file.type === "image/png" || file.type === "image/jpeg") return true;
  if (file.type !== "image/webp") return false;
  const head = new Uint8Array(await file.slice(0, 21).arrayBuffer());
  const chunk = String.fromCharCode(...head.slice(12, 16));
  // Only VP8X can be animated, and it says so in its flags.
  return chunk !== "VP8X" || (head[20] & 0x02) === 0;
}

/** The framed part, drawn at the banner box and encoded as WebP. */
export async function renderBanner(img: HTMLImageElement, c: Crop, frameW: number, frameH: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = BANNER_W;
  canvas.height = BANNER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  const { sx, sy, sw, sh } = sourceRect(c, img.naturalWidth, img.naturalHeight, frameW, frameH);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, BANNER_W, BANNER_H);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("couldn't encode the banner");
  // Safari has no WebP encoder and hands back a PNG instead.
  const type = blob.type || "image/png";
  return new File([blob], type === "image/webp" ? "banner.webp" : "banner.png", { type });
}
