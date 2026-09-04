import { getServerAccessToken, getServerHttpBase, type SealedAttachmentKey } from "@/common";

import type { ImageDimensions } from "../utils/imageUtils";

/** What an upload came back as, and how to read it again if it was sealed. */
export interface UploadedFile {
  fileId: string;
  /** Absent when the file went up as itself. */
  meta?: SealedAttachmentKey;
}

/**
 * Encrypt a file, if this conversation is being encrypted, and upload it.
 *
 * The seal happens here rather than in the caller so the `sealed=1` field and
 * the encryption cannot come apart — a file encrypted without the flag would be
 * validated as an image and refused, and one flagged without being encrypted
 * would be stored opaque and served as a download for no reason.
 *
 * `seal` returning null is the ordinary case: a channel. The file goes as
 * itself.
 */
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
    // Everything the picker knew about this file is inside `sealed.meta` now,
    // and none of it goes on the wire: no name, no type, no dimensions. The
    // server records a length and a time, which is what it can see anyway.
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
      if (err.message) msg = err.message;
      else if (err.error) msg = err.error;
    } catch { /* ignored */ }
    console.error("[Upload] Failed:", { status: resp.status, url: `${base}/api/uploads`, body: raw });
    throw new Error(msg);
  }
  const data = await resp.json();
  return { fileId: data.fileId as string, ...(sealed ? { meta: sealed.meta } : null) };
}
