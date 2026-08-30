import type { SealedAttachmentKey } from "@/common";

import type { AttachmentMeta } from "../components/chatUtils";

/**
 * Turning an encrypted upload back into something the message row can draw
 * (GRYT-761).
 *
 * The server holds ciphertext under `application/octet-stream` with no name and
 * no dimensions, because that is all it was given. Everything a row needs to
 * draw the attachment — what it is called, what it is, how big the picture is —
 * came back inside the sealed message.
 *
 * So this rebuilds the shape the renderer already takes. `local_url` is the
 * seam: it exists for the optimistic preview of a file still uploading, and a
 * blob URL of the decrypted bytes fits it exactly. Nothing in `MessageRow`
 * changes.
 */

/**
 * What the row should show for one decrypted attachment.
 *
 * `has_thumbnail` is false and cannot be otherwise: a thumbnail is made by
 * decoding the picture, and the server was handed noise. An encrypted image
 * draws from the full file. GRYT-764 is the version with previews.
 *
 * `mime` and `original_name` are the sender's, from inside the envelope, and
 * are not verified by anybody. That is the same footing an unencrypted
 * `original_name` has always been on — it is a string somebody chose — and it
 * is why the renderer dispatches on it rather than sniffing the bytes.
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
 * Fetch one attachment and open it.
 *
 * Downloaded with `credentials: "omit"` and no bearer token, deliberately. The
 * download route does not require one, and the bytes are useless without the
 * key — so sending a token here would put a credential on a request that does
 * not need it, in a URL that ends up in a blob the page holds.
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

  // The sender's type, not the server's — the server only ever saw
  // `application/octet-stream`. A blob with the right type is what lets an
  // `<img>` or a `<video>` take the URL without anything else being told.
  return new Blob([plain as BlobPart], {
    type: key.mime || "application/octet-stream",
  });
}
