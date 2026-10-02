import { Button, Dialog, Slider } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";

import { bannerCropGeometry, type CropPoint, type CropSize } from "./bannerCrop";

const OUTPUT_WIDTH = 960;
const OUTPUT_HEIGHT = 384;

export function BannerCropDialog({
  file,
  onCancel,
  onUse,
}: {
  file: File | null;
  onCancel: () => void;
  onUse: (file: File) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ pointer: number; at: CropPoint; start: CropPoint } | null>(null);
  const [url, setUrl] = useState("");
  const [image, setImage] = useState<CropSize>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<CropSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<CropPoint>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    setImage({ width: 0, height: 0 });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(next);
  }, [file]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [file]);

  const crop = bannerCropGeometry(image, viewport, zoom, offset);

  const applyCrop = async () => {
    const element = imageRef.current;
    if (!file || !element || !image.width || !viewport.width) return;
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) {
      setBusy(false);
      return;
    }
    context.drawImage(
      element,
      crop.source.x,
      crop.source.y,
      crop.source.width,
      crop.source.height,
      0,
      0,
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    setBusy(false);
    if (!blob) return;
    onUse(new File([blob], file.name.replace(/\.[^.]+$/, "") + ".webp", { type: blob.type }));
  };

  return (
    <Dialog.Root open={Boolean(file)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[44rem] max-w-[calc(100vw-2rem)]">
          <div className="flex flex-col gap-4">
            <div>
              <Dialog.Title>Position banner</Dialog.Title>
              <Dialog.Description>Drag to move. Scroll or use the slider to zoom.</Dialog.Description>
            </div>
            <div
              ref={viewportRef}
              className="relative aspect-5/2 touch-none cursor-grab overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface active:cursor-grabbing"
              onWheel={(event) => {
                event.preventDefault();
                setZoom((value) => Math.max(1, Math.min(3, value - event.deltaY * 0.0015)));
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { pointer: event.pointerId, at: { x: event.clientX, y: event.clientY }, start: crop.position };
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointer !== event.pointerId) return;
                setOffset({
                  x: Math.max(-crop.limits.x, Math.min(crop.limits.x, drag.start.x + event.clientX - drag.at.x)),
                  y: Math.max(-crop.limits.y, Math.min(crop.limits.y, drag.start.y + event.clientY - drag.at.y)),
                });
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.pointer === event.pointerId) dragRef.current = null;
              }}
            >
              {url && (
                <img
                  ref={imageRef}
                  src={url}
                  alt="Banner crop preview"
                  draggable={false}
                  className="pointer-events-none absolute max-w-none select-none"
                  style={{
                    width: crop.shown.width,
                    height: crop.shown.height,
                    left: `calc(50% - ${crop.shown.width / 2 - crop.position.x}px)`,
                    top: `calc(50% - ${crop.shown.height / 2 - crop.position.y}px)`,
                  }}
                  onLoad={(event) => setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
                />
              )}
            </div>
            <label className="flex items-center gap-3 text-sm font-semibold text-gryt-text">
              <span>Zoom</span>
              <Slider className="flex-1" min={100} max={300} value={Math.round(zoom * 100)} onValueChange={(value) => setZoom(Number(value) / 100)} />
              <span className="w-11 text-right text-xs text-gryt-muted">{Math.round(zoom * 100)}%</span>
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button tone="neutral" onClick={onCancel}>Cancel</Button>
              <Button disabled={busy || !image.width} onClick={() => void applyCrop()}>{busy ? "Preparing…" : "Use crop"}</Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
