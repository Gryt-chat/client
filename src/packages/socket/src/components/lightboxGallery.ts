import type { ChatMessage } from "./chatUtils";
import type { LightboxItem } from "./ImageLightbox";

/** A message's pictures and videos, in the order they were sent, for the lightbox to step through.
    An encrypted video and anything still processing or refused are left out. */
export function galleryOf(message: ChatMessage, serverHost: string | undefined): LightboxItem[] {
  if (!message.attachments || !serverHost) return [];
  const items: LightboxItem[] = [];
  message.attachments.forEach((fileId, i) => {
    const meta = message.enriched_attachments?.[i];
    if (!meta || meta.refused || meta.processing) return;
    const mime = meta.mime || "";
    const kind = mime.startsWith("image/") ? "image" : mime.startsWith("video/") && !meta.open_sealed ? "video" : null;
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
