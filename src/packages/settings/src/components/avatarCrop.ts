/* The square that becomes the avatar, in the source picture's pixels. Twice the biggest the app draws one. */
export const AVATAR_PX = 256;

export interface Box {
  x: number;
  y: number;
  size: number;
}

export type Corner = "nw" | "ne" | "sw" | "se";

/** The largest square the picture holds, centred: the whole width or the whole height. */
export function initialBox(w: number, h: number): Box {
  const size = Math.min(w, h);
  return { x: (w - size) / 2, y: (h - size) / 2, size };
}

/** Moved, and kept inside the picture. */
export function moveBox(b: Box, dx: number, dy: number, w: number, h: number): Box {
  return { size: b.size, x: Math.min(w - b.size, Math.max(0, b.x + dx)), y: Math.min(h - b.size, Math.max(0, b.y + dy)) };
}

/** Pulled by one corner while the opposite one stays put, square, inside the picture and no smaller than `min`. */
export function resizeBox(b: Box, corner: Corner, dx: number, dy: number, w: number, h: number, min: number): Box {
  const sx = corner === "ne" || corner === "se" ? 1 : -1;
  const sy = corner === "sw" || corner === "se" ? 1 : -1;
  const ax = sx > 0 ? b.x : b.x + b.size;
  const ay = sy > 0 ? b.y : b.y + b.size;
  const room = Math.min(sx > 0 ? w - ax : ax, sy > 0 ? h - ay : ay);
  const size = Math.max(Math.min(min, room), Math.min(room, b.size + (sx * dx + sy * dy) / 2));
  return { size, x: sx > 0 ? ax : ax - size, y: sy > 0 ? ay : ay - size };
}

/** Grown or shrunk about its centre, for the keyboard. */
export function scaleBox(b: Box, by: number, w: number, h: number, min: number): Box {
  const size = Math.max(Math.min(min, w, h), Math.min(w, h, b.size + by));
  return moveBox({ size, x: b.x + (b.size - size) / 2, y: b.y + (b.size - size) / 2 }, 0, 0, w, h);
}

function draw(img: HTMLImageElement, b: Box, px: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, b.x, b.y, b.size, b.size, 0, 0, px, px);
  return canvas;
}

/** A small copy for the card preview while the box moves. */
export function previewOf(img: HTMLImageElement, b: Box): string {
  return draw(img, b, 96).toDataURL("image/png");
}

/** The square at AVATAR_PX, as WebP where the browser can encode it. */
export async function renderAvatar(img: HTMLImageElement, b: Box): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => draw(img, b, AVATAR_PX).toBlob(resolve, "image/webp", 0.92));
  if (!blob) throw new Error("couldn't encode the picture");
  // Safari has no WebP encoder and hands back a PNG instead.
  const type = blob.type || "image/png";
  return new File([blob], type === "image/webp" ? "avatar.webp" : "avatar.png", { type });
}
