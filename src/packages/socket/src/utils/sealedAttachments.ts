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
  source: string | (() => Promise<Blob>),
): AttachmentMeta {
  return {
    file_id: fileId,
    mime: key.mime ?? "application/octet-stream",
    size: key.size ?? null,
    original_name: key.name ?? null,
    width: key.width ?? null,
    height: key.height ?? null,
    has_thumbnail: false,
    ...(typeof source === "string" ? { local_url: source } : { open_sealed: source }),
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

/** Decrypting needs the whole file, so a video waits for play instead of downloading with its message (GRYT-1171). */
export function opensOnPlay(key: SealedAttachmentKey): boolean {
  return (key.mime ?? "").startsWith("video/");
}

/**
 * One attachment of a message that just opened. `fileUrl` is called when the fetch
 * happens, so a video played later asks with the token current by then.
 */
export async function openSealedAttachment({
  fileId,
  key,
  fileUrl,
  openFile,
  keepUrl,
}: {
  fileId: string;
  key: SealedAttachmentKey;
  fileUrl: () => string;
  openFile: (ciphertext: Uint8Array, meta: SealedAttachmentKey) => Uint8Array;
  /** Takes the blob URL made for anything opened now, to revoke it later. */
  keepUrl: (url: string) => void;
}): Promise<AttachmentMeta> {
  const fetchOpened = () => fetchSealedAttachment({ url: fileUrl(), key, openFile });
  if (opensOnPlay(key)) return sealedAttachmentMeta(fileId, key, fetchOpened);

  const objectUrl = URL.createObjectURL(await fetchOpened());
  keepUrl(objectUrl);
  return sealedAttachmentMeta(fileId, key, objectUrl);
}
