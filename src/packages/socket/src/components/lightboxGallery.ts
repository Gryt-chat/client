import type { ChatMessage } from "./chatUtils";
import type { LightboxItem } from "./ImageLightbox";

/** A message's pictures and videos, in the order they were sent, for the lightbox to step through.
    Anything still processing, refused or sealed and not yet decrypted is left out. */
export function galleryOf(message: ChatMessage, serverHost: string | undefined): LightboxItem[] {
  if (!message.attachments || !serverHost) return [];
  const items: LightboxItem[] = [];
  message.attachments.forEach((fileId, i) => {
    const meta = message.enriched_attachments?.[i];
    // A sealed file not decrypted yet would load as ciphertext from the server.
    if (!meta || meta.refused || meta.processing || (meta.open_sealed && !meta.local_url)) return;
    const mime = meta.mime || "";
    const kind = (["image", "video"] as const).find((k) => mime.startsWith(`${k}/`)) ?? null;
    if (!kind) return;
    items.push({
      kind,
      name: meta.original_name || (kind === "video" ? "Video" : "Picture"),
      fileId,
      serverHost,
      local: meta.local_url || undefined,
      hasThumbnail: !!meta.has_thumbnail,
    });
  });
  return items;
}
