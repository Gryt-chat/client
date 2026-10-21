import type { AttachmentMeta } from "./chatUtils";

/** Whether an attachment draws in the picture gallery: an image the server didn't refuse. */
export function isGridImage(meta: AttachmentMeta | undefined): boolean {
  return !!meta && !meta.refused && (meta.mime || "").startsWith("image/");
}

/** A plain file, drawn as a card: not a picture, sound or video, and not still processing. */
export function isFileCard(meta: AttachmentMeta | undefined): boolean {
  return !!meta && !meta.refused && !meta.processing && !/^(image|audio|video)\//.test(meta.mime || "");
}
