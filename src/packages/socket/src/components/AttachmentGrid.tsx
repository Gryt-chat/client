import { Spinner } from "@gryt/ui";
import { type CSSProperties, useState } from "react";

import { useStableFileUrl } from "../hooks/useStableFileUrl";
import { readBlobUrl } from "../utils/downloadFile";
import type { AttachmentMeta } from "./chatUtils";
import { type MessageActions, MessageContextMenu } from "./MediaContextMenu";

const GAP = 4;
/** Each square: as many fit across as the chat has room for. */
const SQUARE = 180;
/** Past this many the last square says how many more; clicking it shows them all. */
const SHOWN = 8;

export interface GridImage {
  fileId: string;
  meta: AttachmentMeta | undefined;
}

/** Two or more pictures as a row of squares that fills the width and wraps, each cropped to fill (GRYT-1722). */
export function AttachmentGrid({
  images,
  serverHost,
  messageActions,
  onLightboxOpen,
}: {
  images: GridImage[];
  serverHost: string;
  messageActions: MessageActions;
  onLightboxOpen: (src: string, alt?: string, fileId?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? images : images.slice(0, SHOWN);
  const hidden = images.length - shown.length;

  return (
    // As wide as one row of all of them, capped at the column: the row around it hugs its text.
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, ${SQUARE}px)`, gap: GAP,
      width: shown.length * SQUARE + (shown.length - 1) * GAP, maxWidth: "100%" }}>
      {shown.map((img, i) => (
        <GridTile key={img.fileId} image={img} style={{ width: SQUARE, aspectRatio: "1 / 1" }}
          more={i === shown.length - 1 ? hidden : 0} serverHost={serverHost}
          messageActions={messageActions} onLightboxOpen={onLightboxOpen} onMore={() => setExpanded(true)} />
      ))}
    </div>
  );
}

function GridTile({
  image,
  style,
  more,
  serverHost,
  messageActions,
  onLightboxOpen,
  onMore,
}: {
  image: GridImage;
  style: CSSProperties;
  more: number;
  serverHost: string;
  messageActions: MessageActions;
  onLightboxOpen: (src: string, alt?: string, fileId?: string) => void;
  onMore: () => void;
}) {
  const { fileId, meta } = image;
  const [url, refreshUrl] = useStableFileUrl(serverHost, fileId);
  const local = meta?.local_url;
  const src = local || url;
  const name = meta?.original_name || "Attachment";
  const box: CSSProperties = {
    position: "relative", overflow: "hidden", borderRadius: "var(--gryt-radius-md)",
    background: "var(--gryt-neutral-3)", minWidth: 0, ...style,
  };

  // Still with the image worker: a loader in the tile, over the sender's own copy if there is one.
  if (meta?.processing) {
    return (
      <div role="status" aria-label="Processing attachment" style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {local && <img src={local} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.4 }} />}
        <Spinner size={14} />
      </div>
    );
  }

  // The size lives on this box: the menu's trigger wraps the button in an unsized div.
  return (
    <div style={box}>
    <MessageContextMenu
      media={local ? { open: () => readBlobUrl(local), fileName: meta?.original_name, isImage: true } : { src: url, fileName: meta?.original_name, isImage: true }}
      messageActions={messageActions}
    >
      <button
        type="button"
        aria-label={more > 0 ? `${more} more pictures` : `Open ${name}`}
        onClick={() => (more > 0 ? onMore() : onLightboxOpen(src, name, fileId))}
        style={{ position: "absolute", inset: 0, display: "block", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
      >
        <img src={src} alt={name} loading="lazy" onError={local ? undefined : refreshUrl}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        {more > 0 && (
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgb(0 0 0 / 0.72)", color: "#fff", fontSize: 24, fontWeight: 700 }}>
            +{more}
          </span>
        )}
      </button>
    </MessageContextMenu>
    </div>
  );
}
