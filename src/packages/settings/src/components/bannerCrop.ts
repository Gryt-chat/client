import type { CropShape } from "./pictureCrop";

/* The banner's band: the card's 320 by 164 at 3x. A whole-card banner is the card's 320 by 420 at 3x. */
export const BANNER_W = 960;
export const BANNER_H = 492;
export const CARD_BANNER_H = 1260;
/** PNG, JPEG and still WebP get cropped; GIFs, animated WebP and video go up as they are. */
export async function isStillPicture(file: File): Promise<boolean> {
  if (file.type === "image/png" || file.type === "image/jpeg") return true;
  if (file.type !== "image/webp") return false;
  const head = new Uint8Array(await file.slice(0, 21).arrayBuffer());
  const chunk = String.fromCharCode(...head.slice(12, 16));
  // Only VP8X can be animated, and it says so in its flags.
  return chunk !== "VP8X" || (head[20] & 0x02) === 0;
}

/** The card's banner, cropped at its full 960 by 492. */
export const BANNER_SHAPE: CropShape = { title: "Frame your banner", hint: "Drag the box to move it, pull a corner to resize. The box is exactly what your card shows.", aspect: BANNER_W / BANNER_H, outW: BANNER_W, round: false, name: "banner" };

/** A whole-card banner, cropped at the card's full 960 by 1260. */
export const CARD_BANNER_SHAPE: CropShape = { ...BANNER_SHAPE, aspect: BANNER_W / CARD_BANNER_H, hint: "Drag the box to move it, pull a corner to resize. A short card shows the middle of it." };
