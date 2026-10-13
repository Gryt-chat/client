import { getServerAccessToken, getServerHttpBase, type SealedAttachmentKey } from "@/common";

import type { ImageDimensions } from "../utils/imageUtils";

/** What an upload came back as, and how to read it again if it was sealed. */
export interface UploadedFile {
  fileId: string;
  /** Absent when the file went up as itself. */
  meta?: SealedAttachmentKey;
}

/**
 * Encrypt a file, if this conversation is being encrypted, and upload it. The seal
 * happens here so `sealed=1` and the encryption cannot come apart.
 */
/* Older servers answer with config words a member can't act on; these say what to pass on. */
const STORAGE_CODES: Record<string, string> = {
  s3_not_configured: "This server can't store files yet, so pictures and files can't be sent here. Let whoever runs it know that file storage isn't set up.",
  "S3_BUCKET not configured": "This server can't store files yet, so pictures and files can't be sent here. Let whoever runs it know that file storage isn't set up.",
  s3_disabled: "File uploads are turned off on this server. Let whoever runs it know if you need them.",
};

export async function uploadChatFile(
  file: File,
  serverHost: string,
  dimensions?: ImageDimensions | null,
  seal?: (
    bytes: Uint8Array,
    about?: { name?: string; mime?: string; width?: number; height?: number },
  ) => { ciphertext: Uint8Array; meta: SealedAttachmentKey } | null,
): Promise<UploadedFile> {
  const accessToken = getServerAccessToken(serverHost);
  if (!accessToken) throw new Error("Not authenticated with this server");
  const base = getServerHttpBase(serverHost);

  const sealed = seal
    ? seal(new Uint8Array(await file.arrayBuffer()), {
        name: file.name,
        mime: file.type || undefined,
        width: dimensions?.width,
        height: dimensions?.height,
      })
    : null;

  const form = new FormData();

  if (sealed) {
    // Everything the picker knew is inside `sealed.meta` now, and none of it goes
    // on the wire. The server records a length and a time.
    form.append(
      "file",
      new Blob([sealed.ciphertext as BlobPart], { type: "application/octet-stream" }),
      "sealed.bin",
    );
    form.append("sealed", "1");
  } else {
    form.append("file", file);
    if (dimensions) {
      form.append("width", String(dimensions.width));
      form.append("height", String(dimensions.height));
    }
  }
  const resp = await fetch(`${base}/api/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!resp.ok) {
    const raw = await resp.text().catch(() => "");
    let msg = `Upload failed (${resp.status})`;
    try {
      const err = raw ? JSON.parse(raw) : {};
      if (err.message && !/S3_BUCKET|DISABLE_S3/.test(err.message)) msg = err.message;
      else if (STORAGE_CODES[err.error]) msg = STORAGE_CODES[err.error];
      else if (err.message) msg = err.message;
      else if (err.error) msg = err.error;
    } catch { /* ignored */ }
    console.error("[Upload] Failed:", { status: resp.status, url: `${base}/api/uploads`, body: raw });
    throw new Error(msg);
  }
  const data = await resp.json();
  return { fileId: data.fileId as string, ...(sealed ? { meta: sealed.meta } : null) };
}
