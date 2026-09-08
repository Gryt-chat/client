import type { SealedAttachmentKey } from "@/common";

import type { AttachmentMeta } from "../components/chatUtils";

/**
 * Turning an encrypted upload back into something the message row can draw. The
 * server holds ciphertext; everything a row needs came inside the message.
 */

/**
 * What the row should show for one decrypted attachment. `has_thumbnail` cannot
 * be true: the server was handed noise. `mime` is the sender's, unverified.
 */
export function sealedAttachmentMeta(
  fileId: string,
  key: SealedAttachmentKey,
  objectUrl: string,
): AttachmentMeta {
  return {
    file_id: fileId,
    mime: key.mime ?? "application/octet-stream",
    size: key.size ?? null,
    original_name: key.name ?? null,
    width: key.width ?? null,
    height: key.height ?? null,
    has_thumbnail: false,
    local_url: objectUrl,
  };
}

/**
 * Fetch one attachment and open it. `credentials: "omit"` and no bearer token:
 * the route needs none, and the bytes are useless without the key.
 */
export async function fetchSealedAttachment({
  url,
  key,
  openFile,
}: {
  url: string;
  key: SealedAttachmentKey;
  openFile: (ciphertext: Uint8Array, meta: SealedAttachmentKey) => Uint8Array;
}): Promise<Blob> {
  const resp = await fetch(url, { credentials: "omit" });
  if (!resp.ok) throw new Error(`Attachment fetch failed (${resp.status})`);

  const plain = openFile(new Uint8Array(await resp.arrayBuffer()), key);

  // The sender's type, not the server's — the server only saw
  // `application/octet-stream`, and an `<img>` needs the real one.
  return new Blob([plain as BlobPart], {
    type: key.mime || "application/octet-stream",
  });
}
