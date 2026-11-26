/* The part of a picture that is kept, in its own pixels: w wide and w / aspect tall. */
export interface Box {
  x: number;
  y: number;
  w: number;
}

export type Corner = "nw" | "ne" | "sw" | "se";

/** What the dialog frames: the avatar's circle in a square, or the card's banner. */
export interface CropShape {
  title: string;
  hint: string;
  aspect: number;
  outW: number;
  round: boolean;
  name: string;
}

/** 256 square: twice the biggest the app draws an avatar. */
export const AVATAR_SHAPE: CropShape = { title: "Frame your picture", hint: "Drag the circle to move it, pull a corner to resize. The circle is what everyone sees.", aspect: 1, outW: 256, round: true, name: "avatar" };

/** Rounded square like the server list draws it, at twice the size. */
export const SERVER_ICON_SHAPE: CropShape = { title: "Frame the server picture", hint: "Drag the box to move it, pull a corner to resize. The box is what everyone sees.", aspect: 1, outW: 256, round: false, name: "server-icon" };

/** The size the crop is saved at, so a smaller picture comes out blurry. */
export const bestSize = (s: CropShape) => `Best at ${s.outW} × ${Math.round(s.outW / s.aspect)} px or bigger.`;

/** The largest box of this shape the picture holds, centred: its whole width or its whole height. */
export function initialBox(W: number, H: number, aspect: number): Box {
  const w = Math.min(W, H * aspect);
  return { x: (W - w) / 2, y: (H - w / aspect) / 2, w };
}

/** Moved, and kept inside the picture. */
export function moveBox(b: Box, dx: number, dy: number, W: number, H: number, aspect: number): Box {
  return { w: b.w, x: Math.min(W - b.w, Math.max(0, b.x + dx)), y: Math.min(H - b.w / aspect, Math.max(0, b.y + dy)) };
}

/** Pulled by one corner while the opposite one stays put: same shape, inside the picture, no narrower than `min`. */
export function resizeBox(b: Box, corner: Corner, dx: number, dy: number, W: number, H: number, aspect: number, min: number): Box {
  const sx = corner === "ne" || corner === "se" ? 1 : -1;
  const sy = corner === "sw" || corner === "se" ? 1 : -1;
  const h = b.w / aspect;
  const ax = sx > 0 ? b.x : b.x + b.w;
  const ay = sy > 0 ? b.y : b.y + h;
  const room = Math.min(sx > 0 ? W - ax : ax, (sy > 0 ? H - ay : ay) * aspect);
  const w = Math.max(Math.min(min, room), Math.min(room, b.w + (sx * dx + sy * dy * aspect) / 2));
  return { w, x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - w / aspect };
}

/** Grown or shrunk about its centre, for the keyboard. */
export function scaleBox(b: Box, by: number, W: number, H: number, aspect: number, min: number): Box {
  const most = Math.min(W, H * aspect);
  const w = Math.max(Math.min(min, most), Math.min(most, b.w + by));
  return moveBox({ w, x: b.x + (b.w - w) / 2, y: b.y + (b.w - w) / aspect / 2 }, 0, 0, W, H, aspect);
}

/** Bigger than this and a phone or laptop runs short of memory decoding it; the server refuses past 100M too. */
export const MAX_PICTURE_BYTES = 25 * 1024 * 1024;
export const MAX_PICTURE_PIXELS = 100_000_000;

/** A copy no wider or taller than `side`, so the preview doesn't redraw a 12000 px picture on every move. */
export function smallCopy(img: HTMLImageElement, side: number): { src: CanvasImageSource; scale: number } {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1) return { src: img, scale };
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { src: canvas, scale };
}

function draw(img: CanvasImageSource, b: Box, aspect: number, outW: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = Math.round(outW / aspect);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, b.x, b.y, b.w, b.w / aspect, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A small copy for the card preview while the box moves. */
export function previewOf(small: { src: CanvasImageSource; scale: number }, b: Box, aspect: number): string {
  const s = small.scale;
  return draw(small.src, { x: b.x * s, y: b.y * s, w: b.w * s }, aspect, 240).toDataURL("image/png");
}

/** The kept part at outW wide, as WebP where the browser can encode it. */
export async function renderCrop(img: HTMLImageElement, b: Box, aspect: number, outW: number, name: string): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => draw(img, b, aspect, outW).toBlob(resolve, "image/webp", 0.92));
  if (!blob) throw new Error("couldn't encode the picture");
  // Safari has no WebP encoder and hands back a PNG instead.
  const type = blob.type || "image/png";
  return new File([blob], `${name}.${type === "image/webp" ? "webp" : "png"}`, { type });
}
