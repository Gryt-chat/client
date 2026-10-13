import { Spinner } from "@gryt/ui";
import { type CSSProperties, useState } from "react";

import { useStableFileUrl } from "../hooks/useStableFileUrl";
import { readBlobUrl } from "../utils/downloadFile";
import type { AttachmentMeta } from "./chatUtils";
import { type MessageActions, MessageContextMenu } from "./MediaContextMenu";

const WIDTH = 420;
const GAP = 4;
/** Past this many the last tile says how many more; clicking it shows them all. */
const SHOWN = 4;

export interface GridImage {
  fileId: string;
  meta: AttachmentMeta | undefined;
}

/** Two or more pictures on one message, as a grid (GRYT-1722 draft): 2 across, 3 with the first big, 4 square. */
export function AttachmentGrid({
  images,
  serverHost,
  messageActions,
  onLightboxOpen,
}: {
  images: GridImage[];
  serverHost: string;
  messageActions: MessageActions;
  onLightboxOpen: (src: string, alt?: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? images : images.slice(0, SHOWN);
  const hidden = images.length - shown.length;
  const half = (WIDTH - GAP) / 2;

  const tile = (img: GridImage, style: CSSProperties, more = 0) => (
    <GridTile key={img.fileId} image={img} style={style} more={more} serverHost={serverHost}
      messageActions={messageActions} onLightboxOpen={onLightboxOpen} onMore={() => setExpanded(true)} />
  );

  if (shown.length === 2) {
    return (
      <div style={{ display: "flex", gap: GAP, width: WIDTH, maxWidth: "100%" }}>
        {shown.map((img) => tile(img, { flex: 1, height: 200 }))}
      </div>
    );
  }
  if (shown.length === 3) {
    return (
      <div style={{ display: "flex", gap: GAP, width: WIDTH, maxWidth: "100%", height: 260 }}>
        {tile(shown[0], { flex: 2, height: "100%" })}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: GAP }}>
          {tile(shown[1], { flex: 1 })}
          {tile(shown[2], { flex: 1 })}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: GAP, width: WIDTH, maxWidth: "100%" }}>
      {shown.map((img, i) => tile(img, { height: half * 0.72 }, i === shown.length - 1 ? hidden : 0))}
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
  onLightboxOpen: (src: string, alt?: string) => void;
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

  return (
    <MessageContextMenu
      media={local ? { open: () => readBlobUrl(local), fileName: meta?.original_name, isImage: true } : { src: url, fileName: meta?.original_name, isImage: true }}
      messageActions={messageActions}
    >
      <button
        type="button"
        aria-label={more > 0 ? `${more} more pictures` : `Open ${name}`}
        onClick={() => (more > 0 ? onMore() : onLightboxOpen(src, name))}
        style={{ ...box, display: "block", padding: 0, border: 0, cursor: "zoom-in" }}
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
  );
}
