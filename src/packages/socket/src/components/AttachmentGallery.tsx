import { IconButton, Spinner } from "@gryt/ui";
import { motion, type MotionValue } from "motion/react";
import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useTrack, useTrackPlace } from "react-motion-lightbox";

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

/** Two or more pictures, one at a time on the lightbox's own track: drag, flick or the arrows (GRYT-1839). */
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
  const n = images.length;
  const first = images[0].meta;
  const ratio = first?.width && first.height ? first.width / first.height : 1;
  const aspect = Math.min(Math.max(ratio, ASPECT[0]), ASPECT[1]);

  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const slide = width - PEEK;
  const step = slide + GAP;
  const track = useTrack(n, 0, () => [step, step]);
  const { index, prev, next, x, go } = track;
  // A drag ends in a click, and that one shouldn't open the lightbox.
  const dragged = useRef(false);

  return (
    <div
      style={{ width: WIDTH, maxWidth: "100%" }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        go(e.key === "ArrowRight" ? 1 : -1);
        e.preventDefault();
      }}
    >
      <motion.div
        ref={box}
        style={{ position: "relative", overflow: "hidden", touchAction: "pan-y", cursor: "grab",
          ...(width ? { height: slide / aspect } : { aspectRatio: aspect }) }}
        onPointerDown={() => (dragged.current = false)}
        onPanStart={track.panStart}
        onPan={(_, info) => {
          dragged.current = true;
          track.pan(info.offset.x);
        }}
        onPanEnd={(_, info) => track.panEnd(info.velocity.x)}
        onClickCapture={(e) => dragged.current && e.stopPropagation()}
      >
        {width > 0 &&
          // Keyed by picture, so the one sliding into place stays the same element.
          [...(prev !== next ? [{ i: prev, at: -step }] : []), { i: index, at: 0 }, { i: next, at: step }].map(({ i, at }) => (
            <Slide key={images[i].fileId} x={x} at={at} width={slide} current={at === 0}>
              <GalleryPicture image={images[i]} serverHost={serverHost} messageActions={messageActions} onLightboxOpen={onLightboxOpen} />
            </Slide>
          ))}
      </motion.div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 4, paddingRight: PEEK,
        color: "var(--gryt-neutral-10)", fontSize: 12 }}>
        <IconButton tone="ghost" size="xsmall" aria-label="Previous picture" onClick={() => go(-1)}>
          <PiCaretLeftBold size={14} />
        </IconButton>
        <span aria-live="polite" style={{ minWidth: "3.5em", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {index + 1} / {n}
        </span>
        <IconButton tone="ghost" size="xsmall" aria-label="Next picture" onClick={() => go(1)}>
          <PiCaretRightBold size={14} />
        </IconButton>
      </div>
    </div>
  );
}

function Slide({ x, at, width, current, children }: { x: MotionValue<number>; at: number; width: number; current: boolean; children: ReactNode }) {
  const { left } = useTrackPlace(x, at);
  return (
    <motion.div aria-hidden={!current || undefined} inert={!current} style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, x: left }}>
      {children}
    </motion.div>
  );
}

function GalleryPicture({
  image,
  serverHost,
  messageActions,
  onLightboxOpen,
}: {
  image: GridImage;
  serverHost: string;
  messageActions: MessageActions;
  onLightboxOpen: (src: string, alt?: string, fileId?: string) => void;
}) {
  const { fileId, meta } = image;
  const [url, refreshUrl] = useStableFileUrl(serverHost, fileId);
  const local = meta?.local_url;
  const src = local || url;
  const name = meta?.original_name || "Attachment";
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

  // The size lives on this box: the menu's trigger wraps the button in an unsized div.
  return (
    <div style={box}>
    <MessageContextMenu
      media={local ? { open: () => readBlobUrl(local), fileName: meta?.original_name, isImage: true } : { src: url, fileName: meta?.original_name, isImage: true }}
      messageActions={messageActions}
    >
      <button
        type="button"
        aria-label={`Open ${name}`}
        onClick={() => onLightboxOpen(src, name, fileId)}
        style={{ position: "absolute", inset: 0, display: "block", padding: 0, border: 0, background: "none", cursor: "inherit" }}
      >
        {/* Cropped to fill, like the lightbox's own gallery; the lightbox opens out of that crop. */}
        <img src={src} alt={name} loading="lazy" draggable={false} onError={local ? undefined : refreshUrl}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </button>
    </MessageContextMenu>
    </div>
  );
}
