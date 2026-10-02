export interface CropSize { width: number; height: number }
export interface CropPoint { x: number; y: number }

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

export function bannerCropGeometry(image: CropSize, viewport: CropSize, zoom: number, offset: CropPoint) {
  const cover = image.width && viewport.width
    ? Math.max(viewport.width / image.width, viewport.height / image.height)
    : 1;
  const scale = cover * zoom;
  const shown = { width: image.width * scale, height: image.height * scale };
  const limits = {
    x: Math.max(0, (shown.width - viewport.width) / 2),
    y: Math.max(0, (shown.height - viewport.height) / 2),
  };
  const position = { x: clamp(offset.x, limits.x), y: clamp(offset.y, limits.y) };
  return {
    scale,
    shown,
    limits,
    position,
    source: {
      x: (shown.width / 2 - viewport.width / 2 - position.x) / scale,
      y: (shown.height / 2 - viewport.height / 2 - position.y) / scale,
      width: viewport.width / scale,
      height: viewport.height / scale,
    },
  };
}

const marker = (bytes: Uint8Array, value: string) => {
  const wanted = [...value].map((character) => character.charCodeAt(0));
  return bytes.some((_, index) => wanted.every((byte, offset) => bytes[index + offset] === byte));
};

export function imageBytesMayAnimate(type: string, bytes: Uint8Array): boolean {
  if (type === "image/gif") return true;
  if (type === "image/webp") return marker(bytes, "ANIM") || marker(bytes, "ANMF");
  if (type === "image/png") return marker(bytes, "acTL");
  return false;
}

export async function imageMayAnimate(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
  return imageBytesMayAnimate(file.type, bytes);
}
