import { Button, Dialog } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { BANNER_H, BANNER_W, clampCrop, type Crop, initialCrop, MAX_ZOOM, renderBanner, zoomAbout } from "./bannerCrop";

/**
 * Frames a still picture for the card's banner. Drag moves it, the wheel, a pinch or the slider
 * zooms, and it can never leave a gap. Save hands back exactly what the card will show.
 */
export function BannerCropDialog({ file, onDone }: { file: File | null; onDone: (cropped: File | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  // A callback ref: the dialog portals in after the first render, so an effect would find nothing.
  const [frameEl, setFrameEl] = useState<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);

  useEffect(() => {
    setImg(null);
    setCrop(null);
    if (!file) return setUrl(null);
    const next = URL.createObjectURL(file);
    setUrl(next);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => {
      toast.error("Couldn't open that picture");
      onDone(null);
    };
    el.src = next;
    return () => URL.revokeObjectURL(next);
    // onDone changes every render of the parent; the picture only changes with the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // The frame's size on screen; the crop is kept in its pixels and rescaled when it changes.
  useEffect(() => {
    if (!frameEl) return;
    const measure = () => setFrame({ w: frameEl.clientWidth, h: frameEl.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frameEl);
    return () => ro.disconnect();
  }, [frameEl]);

  const prevFrame = useRef(frame);
  useEffect(() => {
    if (!img || !frame.w) return;
    const before = prevFrame.current;
    prevFrame.current = frame;
    setCrop((c) => {
      if (!c || !before.w) return initialCrop(img.naturalWidth, img.naturalHeight, frame.w, frame.h);
      const k = frame.w / before.w;
      return clampCrop({ zoom: c.zoom, x: c.x * k, y: c.y * k }, img.naturalWidth, img.naturalHeight, frame.w, frame.h);
    });
  }, [img, frame]);

  // Updates go through the setter: a trackpad sends several events between two renders.
  const zoomBy = (z: (now: number) => number, px = frame.w / 2, py = frame.h / 2) => {
    if (!img) return;
    setCrop((c) => c && zoomAbout(c, z(c.zoom), px, py, img.naturalWidth, img.naturalHeight, frame.w, frame.h));
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = frameEl!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // React's wheel listener is passive, so preventDefault needs a native one.
  useEffect(() => {
    const el = frameEl;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomBy((z) => z * Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const before = pointers.current.get(e.pointerId);
    if (!before || !img) return;
    const now = local(e);
    pointers.current.set(e.pointerId, now);
    const all = [...pointers.current.values()];
    if (all.length >= 2) {
      const [a, b] = all;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = pinch.current ? d / pinch.current : 1;
      zoomBy((z) => z * ratio, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.current = d;
      return;
    }
    const dx = now.x - before.x;
    const dy = now.y - before.y;
    setCrop((c) => c && clampCrop({ ...c, x: c.x + dx, y: c.y + dy }, img.naturalWidth, img.naturalHeight, frame.w, frame.h));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };

  const save = async () => {
    if (!img || !crop) return;
    setBusy(true);
    try {
      onDone(await renderBanner(img, crop, frame.w, frame.h));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't crop the banner");
    } finally {
      setBusy(false);
    }
  };

  const shown = img && crop ? img.naturalWidth * crop.zoom * Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight) : 0;

  return (
    <Dialog.Root open={!!file} onOpenChange={(open) => !open && onDone(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="flex w-[40rem] max-w-[calc(100vw-2rem)] flex-col gap-4 p-4">
          <Dialog.Title className="text-lg">Frame your banner</Dialog.Title>
          <Dialog.Description className="text-xs text-gryt-muted">
            Drag to move it, scroll or pinch to zoom. The box is exactly what your card shows.
          </Dialog.Description>
          <div
            ref={setFrameEl}
            className="relative w-full cursor-grab touch-none overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface select-none active:cursor-grabbing"
            style={{ aspectRatio: `${BANNER_W} / ${BANNER_H}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {url && crop && (
              <img
                src={url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute top-0 left-0 max-w-none"
                style={{ width: shown, transform: `translate(${crop.x}px, ${crop.y}px)` }}
              />
            )}
          </div>
          <label className="flex items-center gap-3 text-xs text-gryt-muted">
            Zoom
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop?.zoom ?? 1}
              disabled={!crop}
              onChange={(e) => {
                const z = Number(e.target.value);
                zoomBy(() => z);
              }}
              aria-label="Zoom"
              className="flex-1 accent-(--gryt-accent)"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="small" tone="neutral" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button size="small" disabled={!crop || busy} onClick={() => void save()}>
              Use this
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
