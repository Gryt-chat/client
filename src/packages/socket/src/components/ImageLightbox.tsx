import "react-motion-lightbox/styles.css";

import { VideoPlayer } from "@gryt/ui";
import { useMemo, useState } from "react";
import { Lightbox, type LightboxItem as ShownItem } from "react-motion-lightbox";

import { getUploadsFileUrl } from "@/common";

import { PiCaretLeftBold, PiCaretRightBold, PiCheck, PiCloudArrowDownFill, PiImageFill, PiX } from "../../../../lib/icons";
import { triggerDownload } from "../utils/downloadFile";
import { copyImageToClipboard } from "../utils/mediaClipboard";

/** One picture or video. A file on a server, or a URL already in hand. */
export interface LightboxItem {
  kind: "image" | "video";
  name: string;
  fileId?: string;
  serverHost?: string;
  /** Already here, like a blob the sender has or a decrypted copy. Wins over the server's. */
  local?: string;
  src?: string;
  hasThumbnail?: boolean;
}

export interface LightboxGallery {
  items: LightboxItem[];
  index: number;
  /** Who sent it and when, for the top bar. */
  title?: { name: string; detail?: string };
}

/** The URL to show, and its still for a video. Built once on open: a viewing session is shorter than a file token. */
function shown(item: LightboxItem): ShownItem {
  const stored = item.fileId && item.serverHost && !item.local ? { host: item.serverHost, id: item.fileId } : null;
  const src = stored ? getUploadsFileUrl(stored.host, stored.id) : item.local || item.src || "";
  const still = stored && (item.kind === "image" || item.hasThumbnail) ? getUploadsFileUrl(stored.host, stored.id, { thumb: true }) : undefined;
  return { kind: item.kind, src, alt: item.name, poster: item.kind === "video" ? still : undefined, thumb: still };
}

/** The attachment it was opened from, found by its file id, so it opens out of the thumbnail; else it fades in. */
function thumbnailOf(item: LightboxItem | undefined): Element | null {
  if (!item?.fileId) return null;
  return document.querySelector(`img[src*="${CSS.escape(item.fileId)}"], video[poster*="${CSS.escape(item.fileId)}"]`);
}

/** The part of the picture a cropped thumbnail shows, so the lightbox opens out of exactly that. */
function cropOfThumbnail(el: Element | null): [number, number, number, number] | undefined {
  if (!(el instanceof HTMLImageElement) || !el.naturalWidth || getComputedStyle(el).objectFit !== "cover") return undefined;
  const { width, height } = el.getBoundingClientRect();
  const scale = Math.max(width / el.naturalWidth, height / el.naturalHeight);
  const w = width / (el.naturalWidth * scale);
  const h = height / (el.naturalHeight * scale);
  return [(1 - w) / 2, (1 - h) / 2, w, h];
}

/**
 * Every picture and video in a message, at the one clicked (GRYT-1722), on react-motion-lightbox: swipe or ← →
 * between them, zoom with a double click, the wheel, two fingers or + −. One `src` is a set of one.
 */
export const ImageLightbox = ({
  src,
  alt,
  gallery,
  onClose,
}: {
  src?: string;
  alt?: string;
  gallery?: LightboxGallery;
  onClose: () => void;
}) => {
  const items = useMemo<LightboxItem[]>(
    () => (gallery?.items.length ? gallery.items : [{ kind: "image", name: alt || "Image", src }]),
    [gallery, alt, src],
  );
  const shownItems = useMemo(() => items.map(shown), [items]);
  const [index, setIndex] = useState(() => Math.min(Math.max(gallery?.index ?? 0, 0), items.length - 1));
  // Closed here first, so it animates back into the thumbnail; the caller unmounts it once that's done.
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const copy = (url: string) =>
    void copyImageToClipboard(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });

  return (
    <Lightbox
      className="gryt-lightbox"
      items={shownItems}
      index={index}
      open={open}
      onClose={() => setOpen(false)}
      onExited={onClose}
      onIndexChange={setIndex}
      origin={(i) => thumbnailOf(items[i])}
      originCrop={(i) => cropOfThumbnail(thumbnailOf(items[i]))}
      title={() =>
        gallery?.title && (
          <>
            <strong>{gallery.title.name}</strong>
            {gallery.title.detail && <span> · {gallery.title.detail}</span>}
          </>
        )
      }
      toolbar={(item, i) => (
        <>
          {item.kind === "image" && (
            <button type="button" className="rml-button" aria-label={copied ? "Copied" : "Copy image"} data-tip={copied ? "Copied" : "Copy image"} onClick={() => copy(item.src)}>
              {copied ? <PiCheck size={18} /> : <PiImageFill size={18} />}
            </button>
          )}
          <button
            type="button"
            className="rml-button"
            aria-label={item.kind === "video" ? "Save video" : "Save image"}
            data-tip={item.kind === "video" ? "Save video" : "Save image"}
            onClick={() => void triggerDownload(item.src, items[i].name)}
          >
            <PiCloudArrowDownFill size={18} />
          </button>
        </>
      )}
      renderVideo={(item, { active }) => (
        <div className="gryt-lightbox-video">
          {active && <VideoPlayer src={item.src} poster={item.poster} fileName={item.alt ?? "Video"} autoLoad />}
        </div>
      )}
      icons={{ close: <PiX size={18} />, previous: <PiCaretLeftBold size={24} />, next: <PiCaretRightBold size={24} /> }}
    />
  );
};
