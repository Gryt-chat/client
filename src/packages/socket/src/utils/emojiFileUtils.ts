import { unzipSync } from "fflate";

export const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;
// SVG is deliberately absent from all four of these. The server refuses it —
// an SVG is a document, it can carry a script, and Gryt served them back inline
// from its own origin until that was fixed. Offering it here only meant picking
// a file and being told no after the upload.
const IMAGE_MIME_RE = /^image\/(png|jpeg|webp|gif|avif)$/i;
export const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);
export const DEFAULT_MAX_EMOJI_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIME_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/avif,.avif,.zip,application/zip";

export type EmojiItem = { name: string; file_id: string };

export interface PendingEmoji {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  nameError: string | null;
  nameWarning: string | null;
  status: "pending" | "uploading" | "processing" | "done" | "error";
  progress: number;
}

export function deriveEmojiName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/^\d+[-_]/, "");
  const sanitized = base.replace(/[^A-Za-z0-9_]/g, "_");
  const trimmed = sanitized.replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
  if (trimmed.length < 2) return trimmed.padEnd(2, "_");
  return trimmed.slice(0, 32);
}

function extToMime(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
  if (lower === "png") return "image/png";
  if (lower === "webp") return "image/webp";
  if (lower === "gif") return "image/gif";
  if (lower === "avif") return "image/avif";
  return "application/octet-stream";
}

export function isImageFile(file: File): boolean {
  return IMAGE_MIME_RE.test(file.type) || IMAGE_EXT_RE.test(file.name);
}

export function isZipFile(file: File): boolean {
  return ZIP_TYPES.has(file.type) || file.name.toLowerCase().endsWith(".zip");
}

export async function extractImagesFromZip(zipFile: File, maxEmojiBytes: number): Promise<{
  images: File[];
  skippedNonImage: number;
  skippedTooLarge: number;
  skippedEmpty: number;
}> {
  const buf = await zipFile.arrayBuffer();
  const entries = unzipSync(new Uint8Array(buf));
  const images: File[] = [];
  let skippedNonImage = 0;
  let skippedTooLarge = 0;
  let skippedEmpty = 0;

  for (const [path, data] of Object.entries(entries)) {
    if (path.startsWith("__MACOSX/") || path.endsWith("/")) continue;
    const filename = path.split("/").pop() || path;
    if (!IMAGE_EXT_RE.test(filename)) { skippedNonImage++; continue; }
    if (data.length === 0) { skippedEmpty++; continue; }
    if (data.length > maxEmojiBytes) { skippedTooLarge++; continue; }
    const ext = filename.split(".").pop() || "png";
    const mime = extToMime(ext);
    const copied = new Uint8Array(data) as BlobPart;
    images.push(new File([copied], filename, { type: mime }));
  }

  return { images, skippedNonImage, skippedTooLarge, skippedEmpty };
}

export function validateName(
  name: string,
  existingNames: Set<string>,
  batchNames: string[],
  selfIndex: number,
): { error: string | null; warning: string | null } {
  if (!name) return { error: "Name is required.", warning: null };
  if (!EMOJI_NAME_RE.test(name)) return { error: "2-32 letters (case-sensitive), numbers, or underscores.", warning: null };
  for (let i = 0; i < batchNames.length; i++) {
    if (i !== selfIndex && batchNames[i] === name) return { error: null, warning: "Duplicate in selection — last one wins." };
  }
  if (existingNames.has(name)) return { error: null, warning: "Already exists — will replace." };
  return { error: null, warning: null };
}
