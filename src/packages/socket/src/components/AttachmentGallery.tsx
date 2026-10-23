import "react-motion-lightbox/styles.css";

import { Spinner } from "@gryt/ui";
import { type CSSProperties, useEffect, useRef } from "react";
import { Gallery, type LightboxItem } from "react-motion-lightbox";

import { PiCaretLeftBold, PiCaretRightBold } from "../../../../lib/icons";
import { useStableFileUrl } from "../hooks/useStableFileUrl";
import { readBlobUrl } from "../utils/downloadFile";
import type { AttachmentMeta } from "./chatUtils";
import { type MessageActions, MessageContextMenu } from "./MediaContextMenu";

const WIDTH = 420;
/** How much of the next picture shows at the right edge, so it reads as something to swipe. */
const PEEK = 28;
const GAP = 6;
/** The first picture's shape, kept between 4:5 and 16:9 so the box is never a sliver or a tower. */
const ASPECT: [number, number] = [4 / 5, 16 / 9];

export interface GridImage {
  fileId: string;
  meta: AttachmentMeta | undefined;
}

/** Two or more pictures, one at a time on react-motion-lightbox's Gallery: drag, flick or the arrows (GRYT-1839). */
export function AttachmentGallery({
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
  const first = images[0].meta;
  const ratio = first?.width && first.height ? first.width / first.height : 1;
  // Each picture loads through its own slide, which keeps its URL here for opening it.
  const urls = useRef(new Map<string, string>());
  const items: LightboxItem[] = images.map(({ meta }) => ({
    kind: "image", src: "", alt: meta?.original_name || "Attachment", width: meta?.width ?? 1, height: meta?.height ?? 1,
  }));

  return (
    <div style={{ width: WIDTH, maxWidth: "100%" }}>
      <Gallery
        className="gryt-gallery"
        items={items}
        aspect={Math.min(Math.max(ratio, ASPECT[0]), ASPECT[1])}
        peek={PEEK}
        gap={GAP}
        radius={0}
        labels={{ previous: "Previous picture", next: "Next picture" }}
        icons={{ previous: <PiCaretLeftBold size={14} />, next: <PiCaretRightBold size={14} /> }}
        renderSlide={(_, i) => <GalleryPicture image={images[i]} serverHost={serverHost} messageActions={messageActions} urls={urls.current} />}
        onPress={(i) => {
          const { fileId, meta } = images[i];
          const src = urls.current.get(fileId);
          if (src && !meta?.processing) onLightboxOpen(src, items[i].alt, fileId);
        }}
      />
    </div>
  );
}

function GalleryPicture({
  image,
  serverHost,
  messageActions,
  urls,
}: {
  image: GridImage;
  serverHost: string;
  messageActions: MessageActions;
  urls: Map<string, string>;
}) {
  const { fileId, meta } = image;
  const [url, refreshUrl] = useStableFileUrl(serverHost, fileId);
  const local = meta?.local_url;
  const src = local || url;
  useEffect(() => {
    urls.set(fileId, src);
  }, [urls, fileId, src]);
  const box: CSSProperties = {
    position: "absolute", inset: 0, overflow: "hidden", borderRadius: "var(--gryt-radius-md)",
    background: "var(--gryt-neutral-3)",
  };

  // Still with the image worker: a loader in its place, over the sender's own copy if there is one.
  if (meta?.processing) {
    return (
      <div role="status" aria-label="Processing attachment" style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {local && <img src={local} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.4 }} />}
        <Spinner size={14} />
      </div>
    );
  }

  // The size lives on this box: the menu's trigger wraps the picture in an unsized div.
  return (
    <div style={box}>
    <MessageContextMenu
      media={local ? { open: () => readBlobUrl(local), fileName: meta?.original_name, isImage: true } : { src: url, fileName: meta?.original_name, isImage: true }}
      messageActions={messageActions}
    >
      {/* Cropped to fill, like the lightbox's own gallery; the lightbox opens out of that crop. */}
      <img src={src} alt="" loading="lazy" draggable={false} onError={local ? undefined : refreshUrl}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </MessageContextMenu>
    </div>
  );
}
