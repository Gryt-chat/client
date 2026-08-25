/**
 * Writing an owl out as a file, so it can be used somewhere other than Gryt.
 *
 * Four formats, and the differences between them are not cosmetic:
 *
 *   - **SVG** is what the generator actually produces. A few kilobytes, no
 *     resolution at all, and it scales to a billboard. It is offered first
 *     because it is the honest answer to "give me my owl"; every other option
 *     here is that file, flattened.
 *   - **PNG** is the one to hand to something that will not take an SVG, which
 *     is most places. Keeps its transparency.
 *   - **WebP** is the same picture at roughly a third of the bytes, for anywhere
 *     that takes it.
 *   - **JPEG** has no alpha. The owl is drawn on its palette background, so
 *     there is something behind it rather than the black a transparent PNG
 *     collapses to — but it is the format where that stops being a detail, and
 *     it is last for that reason.
 *
 * 1024 square for the rasters. That is the frame the generator draws on, so it
 * is a whole-number scale of the real geometry rather than a resample of a
 * smaller one, and it is past the point where the file is the limiting factor
 * anywhere somebody is likely to paste it.
 */

import { owlAvatarDataUri, owlAvatarSvg, type WornLook,wornToOptions } from "@gryt/owl";

/** The size a raster export is written at. See the note above. */
export const EXPORT_SIZE = 1024;

export interface ExportFormat {
  id: "svg" | "png" | "webp" | "jpeg";
  label: string;
  /** What it is good for, in the few words a menu row has. */
  hint: string;
  extension: string;
  mime: string;
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: "svg", label: "SVG", hint: "Any size, a few kB", extension: "svg", mime: "image/svg+xml" },
  { id: "png", label: "PNG", hint: `${EXPORT_SIZE}px, transparent`, extension: "png", mime: "image/png" },
  { id: "webp", label: "WebP", hint: `${EXPORT_SIZE}px, smaller`, extension: "webp", mime: "image/webp" },
  { id: "jpeg", label: "JPEG", hint: `${EXPORT_SIZE}px, no transparency`, extension: "jpg", mime: "image/jpeg" },
];

/**
 * The owl as a blob in one of the formats above.
 *
 * The rasters go through an `<img>` and a canvas so the browser draws the same
 * SVG it would have drawn on screen, rather than this reimplementing the
 * geometry and getting a slightly different owl.
 */
export async function renderOwl(
  seed: string,
  look: WornLook,
  format: ExportFormat,
  size = EXPORT_SIZE,
): Promise<Blob> {
  const options = { ...wornToOptions(look), size };

  if (format.id === "svg") {
    return new Blob([owlAvatarSvg(seed, options)], { type: format.mime });
  }

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("could not draw the owl"));
    image.src = owlAvatarDataUri(seed, options);
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(image, 0, 0, size, size);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          // A browser that does not encode this format hands back null rather
          // than throwing, and a caller that assumed otherwise would save an
          // empty file. WebP is the one this happens to.
          reject(new Error(`this browser cannot write ${format.label}`));
          return;
        }
        resolve(blob);
      },
      format.mime,
      // Only read for the lossy formats. 0.92 is the browser default for JPEG
      // and is well past the point where an owl — flat fills and hard edges —
      // shows any artefacts.
      0.92,
    );
  });
}

/** `sivert-owl.png`, and nothing a filesystem will refuse. */
export function exportFilename(nickname: string, format: ExportFormat): string {
  const stem =
    nickname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "gryt";
  return `${stem}-owl.${format.extension}`;
}

/**
 * Hand the blob to the browser as a download.
 *
 * The object URL is revoked on a timer rather than immediately. Revoking in the
 * same tick can beat the download starting, and the failure is a save that
 * silently does nothing.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
