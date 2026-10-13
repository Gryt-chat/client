import { VideoPlayer } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PiCaretLeftBold,
  PiCaretRightBold,
  PiCheck,
  PiCloudArrowDownFill,
  PiImageFill,
  PiMagnifyingGlassMinusBold,
  PiMagnifyingGlassPlusBold,
  PiPlayFill,
  PiX,
} from "../../../../lib/icons";
import { useStableFileUrl } from "../hooks/useStableFileUrl";
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

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Every picture and video in a message, at the one clicked: arrows and ← → move, + − and the
 * wheel zoom, drag looks around while zoomed, Esc closes (GRYT-1722). One `src` is a set of one.
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
  const items: LightboxItem[] = gallery?.items.length ? gallery.items : [{ kind: "image", name: alt || "Image", src }];
  const [index, setIndex] = useState(() => Math.min(Math.max(gallery?.index ?? 0, 0), items.length - 1));
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const [shownSrc, setShownSrc] = useState<string | undefined>(undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const item = items[index];
  const many = items.length > 1;

  const go = useCallback((to: number) => {
    if (to < 0 || to >= items.length) return;
    setIndex(to);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [items.length]);

  const zoomTo = useCallback((next: number) => {
    const z = clampZoom(next);
    setZoom(z);
    if (z === 1) setPan({ x: 0, y: 0 });
    else setPan((p) => ({ x: (p.x * z) / zoom, y: (p.y * z) / zoom }));
  }, [zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "ArrowRight") go(index + 1);
      else if (item.kind === "image" && (e.key === "+" || e.key === "=")) zoomTo(zoom * 1.5);
      else if (item.kind === "image" && e.key === "-") zoomTo(zoom / 1.5);
      else if (item.kind === "image" && e.key === "0") zoomTo(1);
      else if (item.kind === "video" && e.key === " ") {
        const video = stageRef.current?.querySelector("video");
        if (video) {
          e.preventDefault();
          if (video.paused) void video.play(); else video.pause();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, index, item.kind, zoom, zoomTo]);

  const onWheel = (e: React.WheelEvent) => {
    if (item.kind !== "image") return;
    zoomTo(zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
  };

  const copy = () => {
    if (!shownSrc) return;
    void copyImageToClipboard(shownSrc).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="lightbox-backdrop" role="dialog" aria-label={`${item.name}, ${index + 1} of ${items.length}`}
      onClick={(e) => { if (e.target === e.currentTarget || e.target === stageRef.current) onClose(); }}>
      <div className="lightbox-top">
        <div className="lightbox-who">
          {gallery?.title && (
            <>
              <span className="lightbox-who-name">{gallery.title.name}</span>
              {gallery.title.detail && <span className="lightbox-who-detail">{gallery.title.detail}</span>}
            </>
          )}
        </div>
        <span className="lightbox-counter">{many ? `${index + 1} of ${items.length}` : ""}</span>
        <div className="lightbox-actions">
          {item.kind === "image" && (
            <>
              <button type="button" className="lightbox-toolbar-btn" aria-label="Zoom out (−)" title="Zoom out (−)" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom / 1.5)}>
                <PiMagnifyingGlassMinusBold size={18} />
              </button>
              {zoom > 1 && (
                <button type="button" className="lightbox-zoom-chip" title="Fit (0)" onClick={() => zoomTo(1)}>
                  {Math.round(zoom * 100)}% · Fit
                </button>
              )}
              <button type="button" className="lightbox-toolbar-btn" aria-label="Zoom in (+)" title="Zoom in (+)" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom * 1.5)}>
                <PiMagnifyingGlassPlusBold size={18} />
              </button>
              <button type="button" className="lightbox-toolbar-btn" aria-label={copied ? "Copied" : "Copy image"} title={copied ? "Copied" : "Copy image"} onClick={copy}>
                {copied ? <PiCheck size={18} /> : <PiImageFill size={18} />}
              </button>
            </>
          )}
          <button type="button" className="lightbox-toolbar-btn" aria-label="Save" title="Save" onClick={() => { if (shownSrc) void triggerDownload(shownSrc, item.name); }}>
            <PiCloudArrowDownFill size={18} />
          </button>
          <button type="button" className="lightbox-toolbar-btn" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose}>
            <PiX size={18} />
          </button>
        </div>
      </div>

      <div ref={stageRef} className="lightbox-stage" onWheel={onWheel}
        onMouseDown={(e) => { if (zoom > 1) drag.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }; }}
        onMouseMove={(e) => { if (drag.current) setPan({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
        onMouseUp={() => { drag.current = null; }}
        onMouseLeave={() => { drag.current = null; }}>
        <LightboxMedia key={`${index}`} item={item} zoom={zoom} pan={pan} onResolved={setShownSrc}
          onToggleZoom={() => zoomTo(zoom > 1 ? 1 : 2)} />
      </div>

      {many && zoom === 1 && index > 0 && (
        <button type="button" className="lightbox-arrow" data-side="left" aria-label="Previous (←)" title="Previous (←)" onClick={() => go(index - 1)}>
          <PiCaretLeftBold size={24} />
        </button>
      )}
      {many && zoom === 1 && index < items.length - 1 && (
        <button type="button" className="lightbox-arrow" data-side="right" aria-label="Next (→)" title="Next (→)" onClick={() => go(index + 1)}>
          <PiCaretRightBold size={24} />
        </button>
      )}

      {many && (
        <div className="lightbox-strip" role="tablist" aria-label="Pictures in this message">
          {items.map((it, i) => (
            <LightboxThumb key={i} item={it} active={i === index} onClick={() => go(i)} label={`${it.name}, ${i + 1} of ${items.length}`} />
          ))}
        </div>
      )}
      <div className="lightbox-hint">
        {item.kind === "video" ? "Space plays and pauses · Esc closes" : zoom > 1 ? "Drag to look around · 0 fits it back" : many ? "← → next and previous · + − zoom · Esc closes" : "+ − zoom · Esc closes"}
      </div>
    </div>
  );
};

/** The current picture or video. A server file gets a URL that survives its token expiring. */
function LightboxMedia({ item, ...rest }: { item: LightboxItem; zoom: number; pan: { x: number; y: number }; onResolved: (src: string) => void; onToggleZoom: () => void }) {
  if (item.fileId && item.serverHost && !item.local) return <ServerMedia item={item} serverHost={item.serverHost} fileId={item.fileId} {...rest} />;
  return <ShownMedia item={item} src={item.local || item.src || ""} {...rest} />;
}

function ServerMedia({ item, serverHost, fileId, ...rest }: { item: LightboxItem; serverHost: string; fileId: string; zoom: number; pan: { x: number; y: number }; onResolved: (src: string) => void; onToggleZoom: () => void }) {
  const [url, refresh] = useStableFileUrl(serverHost, fileId);
  const [poster] = useStableFileUrl(serverHost, fileId, true);
  return <ShownMedia item={item} src={url} poster={item.hasThumbnail ? poster : undefined} onError={refresh} {...rest} />;
}

function ShownMedia({ item, src, poster, onError, zoom, pan, onResolved, onToggleZoom }: {
  item: LightboxItem; src: string; poster?: string; onError?: () => void;
  zoom: number; pan: { x: number; y: number }; onResolved: (src: string) => void; onToggleZoom: () => void;
}) {
  useEffect(() => { if (src) onResolved(src); }, [src, onResolved]);
  if (item.kind === "video") {
    return (
      <div className="lightbox-video">
        <VideoPlayer src={src} poster={poster} fileName={item.name} autoLoad onError={onError} />
      </div>
    );
  }
  return (
    <img src={src} alt={item.name} draggable={false} className="lightbox-image" onError={onError}
      onDoubleClick={onToggleZoom}
      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? "grab" : "zoom-in" }} />
  );
}

function LightboxThumb({ item, active, onClick, label }: { item: LightboxItem; active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} aria-label={label} className="lightbox-thumb" data-active={active || undefined} onClick={onClick}>
      {item.kind === "image" || item.hasThumbnail
        ? (item.fileId && item.serverHost && !item.local
          ? <ServerThumb serverHost={item.serverHost} fileId={item.fileId} poster={item.kind === "video"} />
          : <img src={item.local || item.src} alt="" draggable={false} />)
        : null}
      {item.kind === "video" && <span className="lightbox-thumb-play"><PiPlayFill size={16} /></span>}
    </button>
  );
}

function ServerThumb({ serverHost, fileId, poster }: { serverHost: string; fileId: string; poster: boolean }) {
  const [url, refresh] = useStableFileUrl(serverHost, fileId, poster);
  return <img src={url} alt="" draggable={false} onError={refresh} />;
}
