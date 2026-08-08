/**
 * The bits of importing emotes that do not care where they came from.
 *
 * BetterTTV and emoji.gg differ in exactly four places — how a link is
 * recognised, how a listing is fetched, where the preview image lives, and
 * which proxy the file is downloaded through. Everything after that (picking,
 * renaming, validating, uploading, progress) is the same work, so it is
 * written once here and in useEmoteImport, and the two sources are described
 * in emoteImportSources.ts.
 */
export const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;

export type EmoteImportStatus = "idle" | "downloading" | "uploading" | "processing" | "error";

export interface ImportEmote {
  /** Unique within a batch. The source's own id or slug. */
  id: string;
  /** What the source calls it, before Gryt's naming rules are applied. */
  code: string;
  imageType: string;
  animated: boolean;
  /** Shown in the row. Fetched straight from the source's CDN. */
  previewUrl: string;
  /** Downloaded through the server, which is what enforces the size limit. */
  fileUrl: string;
}

export interface ImportEmoteWithMeta extends ImportEmote {
  selected: boolean;
  name: string;
  nameError: string | null;
  nameWarning: string | null;
  status: EmoteImportStatus;
  progress: number;
  lastError: string | null;
}

export function sanitizeName(code: string): string {
  const sanitized = code.replace(/[^A-Za-z0-9_]/g, "_");
  const trimmed = sanitized.replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
  if (trimmed.length < 2) return trimmed.padEnd(2, "_");
  return trimmed.slice(0, 32);
}

function mimeToExt(mime: string): string | null {
  const lower = mime.toLowerCase();
  if (lower === "image/png") return "png";
  if (lower === "image/jpeg") return "jpg";
  if (lower === "image/gif") return "gif";
  if (lower === "image/webp") return "webp";
  if (lower === "image/avif") return "avif";
  if (lower === "image/svg+xml") return "svg";
  return null;
}

export async function downloadAsFileWithProgress({
  url,
  name,
  fallbackMime,
  onProgress,
}: {
  url: string;
  name: string;
  fallbackMime: string;
  onProgress: (pct: number) => void;
}): Promise<File> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    const data: unknown = await resp.json().catch(() => null);
    const root = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
    const msg = typeof root.message === "string" ? root.message : `Failed to fetch emote file (${resp.status})`;
    throw new Error(msg);
  }

  const mime = resp.headers.get("content-type") || fallbackMime;
  const ext = mimeToExt(mime) ?? "bin";
  const contentLengthHeader = resp.headers.get("content-length");
  const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : null;

  const body = resp.body;
  if (!body) {
    const blob = await resp.blob();
    onProgress(100);
    return new File([blob], `${name}.${ext}`, { type: mime });
  }

  const reader = body.getReader();
  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  let received = 0;
  onProgress(0);

  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    const value = result.value;
    if (!value) continue;

    // Copy into an ArrayBuffer-backed Uint8Array (avoids SharedArrayBuffer typing issues).
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    chunks.push(copy);
    received += value.byteLength;
    if (typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0) {
      const pct = Math.round((received / totalBytes) * 100);
      onProgress(Math.max(0, Math.min(100, pct)));
    } else {
      onProgress(Math.min(99, Math.max(1, Math.round(received / 1024))));
    }
  }

  onProgress(100);
  const blob = new Blob(chunks, { type: mime });
  return new File([blob], `${name}.${ext}`, { type: mime });
}

export function validateName(
  name: string,
  existingNames: Set<string>,
  batchNames: string[],
  selfIndex: number,
): { error: string | null; warning: string | null } {
  if (!name) return { error: "Name is required.", warning: null };
  if (!EMOJI_NAME_RE.test(name))
    return { error: "2-32 letters (case-sensitive), numbers, or underscores.", warning: null };
  for (let i = 0; i < batchNames.length; i++) {
    if (i !== selfIndex && batchNames[i] === name)
      return { error: null, warning: "Duplicate in selection — last one wins." };
  }
  if (existingNames.has(name))
    return { error: null, warning: "Already exists — will replace." };
  return { error: null, warning: null };
}
