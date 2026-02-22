export type CompressAvatarOptions = {
  maxBytes: number;
  sizePx?: number; // default 256
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Failed to encode image"));
      },
      type,
      quality
    );
  });
}

async function decodeToImageBitmap(file: Blob): Promise<{ bitmap: ImageBitmap; close: () => void }> {
  // Prefer createImageBitmap (fast, avoids DOM).
  try {
    const bitmap = await createImageBitmap(file);
    return { bitmap, close: () => bitmap.close?.() };
  } catch {
    // Fallback to HTMLImageElement decode.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width || 1;
      canvas.height = img.naturalHeight || img.height || 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D context");
      ctx.drawImage(img, 0, 0);
      const bitmap = await createImageBitmap(canvas);
      return { bitmap, close: () => bitmap.close?.() };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function drawCover(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, size: number) {
  const sw = bitmap.width;
  const sh = bitmap.height;
  if (!sw || !sh) throw new Error("Invalid image dimensions");

  const scale = Math.max(size / sw, size / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const dx = Math.round((size - dw) / 2);
  const dy = Math.round((size - dh) / 2);

  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bitmap, dx, dy, dw, dh);
}

/**
 * Compress a static avatar image (PNG/JPEG/WebP) to fit under maxBytes.
 * This does NOT support animated GIF compression (use server-side or ask user to upload a smaller GIF).
 */
export async function compressStaticAvatarToLimit(file: File, opts: CompressAvatarOptions): Promise<Blob> {
  const maxBytes = Math.floor(opts.maxBytes);
  const sizePx = clamp(Math.floor(opts.sizePx ?? 256), 64, 512);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return file;
  if (file.size > 0 && file.size <= maxBytes) return file;

  const { bitmap, close } = await decodeToImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("No 2D context");

    drawCover(ctx, bitmap, sizePx);

    const candidates: Array<{ type: string; qualities: number[] }> = [
      { type: "image/webp", qualities: [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48, 0.42] },
      { type: "image/jpeg", qualities: [0.9, 0.82, 0.75, 0.68, 0.6, 0.52, 0.45] },
    ];

    let best: Blob | null = null;

    for (const dim of [sizePx, Math.round(sizePx * 0.85), Math.round(sizePx * 0.7)]) {
      if (dim !== canvas.width) {
        canvas.width = dim;
        canvas.height = dim;
        const ctx2 = canvas.getContext("2d", { alpha: true });
        if (!ctx2) throw new Error("No 2D context");
        drawCover(ctx2, bitmap, dim);
      }

      for (const c of candidates) {
        for (const q of c.qualities) {
          let blob: Blob;
          try {
            blob = await canvasToBlob(canvas, c.type, q);
          } catch {
            continue;
          }
          if (!best || blob.size < best.size) best = blob;
          if (blob.size <= maxBytes) return blob;
        }
      }
    }

    return best || file;
  } finally {
    close();
  }
}

