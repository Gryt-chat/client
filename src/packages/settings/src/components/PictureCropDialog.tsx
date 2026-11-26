import { Button, Dialog } from "@gryt/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { bestSize, type Box, type Corner, type CropShape, initialBox, MAX_PICTURE_BYTES, MAX_PICTURE_PIXELS, moveBox, previewOf, renderCrop, resizeBox, scaleBox, smallCopy } from "./pictureCrop";

const FRAME_W = 300, FRAME_H = 280;
// Room around the picture, so a corner handle on its edge isn't cut off by the frame.
const PAD = 10;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const CORNER_LABEL: Record<Corner, string> = { nw: "top left", ne: "top right", sw: "bottom left", se: "bottom right" };

/**
 * Frames a still picture: the whole picture shows, the box on it is what's kept. Drag moves the box,
 * a corner resizes it, and the card beside it shows the result.
 */
export function PictureCropDialog({ file, shape, onDone, preview }: { file: File | null; shape: CropShape; onDone: (cropped: File | null) => void; preview?: (src: string) => ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [small, setSmall] = useState<ReturnType<typeof smallCopy> | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ corner: Corner | null; x: number; y: number } | null>(null);
  const a = shape.aspect;

  useEffect(() => {
    setImg(null);
    setSmall(null);
    setBox(null);
    setShown(null);
    if (!file) return setUrl(null);
    const refuse = (why: string) => {
      toast.error(why);
      onDone(null);
    };
    if (file.size > MAX_PICTURE_BYTES) return refuse("That picture is too large (max 25 MB).");
    const next = URL.createObjectURL(file);
    setUrl(null);
    let live = true;
    const el = new Image();
    el.onload = () => {
      if (!live) return;
      const { naturalWidth: w, naturalHeight: h } = el;
      if (w * h > MAX_PICTURE_PIXELS) return refuse("That picture has too many pixels to open.");
      // The box would be too thin to see or grab.
      if (Math.min(w, h * a) * Math.min((FRAME_W - 2 * PAD) / w, (FRAME_H - 2 * PAD) / h) < 24) return refuse("That picture is too narrow to frame.");
      setUrl(next);
      setImg(el);
      setSmall(smallCopy(el, 1200));
      setBox(initialBox(w, h, a));
    };
    el.onerror = () => {
      if (live) refuse("Couldn't open that picture");
    };
    el.src = next;
    return () => {
      live = false;
      URL.revokeObjectURL(next);
    };
    // onDone changes every render of the parent; the picture only changes with the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // The card preview follows the box, a frame at a time.
  useEffect(() => {
    if (!small || !box || !preview) return;
    const id = requestAnimationFrame(() => setShown(previewOf(small, box, a)));
    return () => cancelAnimationFrame(id);
  }, [small, box, preview, a]);

  const W = img?.naturalWidth ?? 1, H = img?.naturalHeight ?? 1;
  // The picture fits the frame whole; k turns its pixels into the frame's.
  const k = Math.min((FRAME_W - 2 * PAD) / W, (FRAME_H - 2 * PAD) / H);
  const left = (FRAME_W - W * k) / 2, top = (FRAME_H - H * k) / 2;
  const min = Math.min(W, H * a) * 0.1;

  const start = (corner: Corner | null) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { corner, x: e.clientX, y: e.clientY };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / k, dy = (e.clientY - d.y) / k;
    d.x = e.clientX;
    d.y = e.clientY;
    setBox((b) => b && (d.corner ? resizeBox(b, d.corner, dx, dy, W, H, a, min) : moveBox(b, dx, dy, W, H, a)));
  };
  const end = () => { drag.current = null; };

  const onKey = (e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 0.05 : 0.01) * Math.min(W, H * a);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) setBox((b) => b && moveBox(b, ...moves[e.key], W, H, a));
    else if (e.key === "+" || e.key === "=") setBox((b) => b && scaleBox(b, step * 2, W, H, a, min));
    else if (e.key === "-") setBox((b) => b && scaleBox(b, -step * 2, W, H, a, min));
    else return;
    e.preventDefault();
  };

  const save = async () => {
    if (!img || !box) return;
    setBusy(true);
    try {
      onDone(await renderCrop(img, box, a, shape.outW, shape.name));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't crop the picture");
    } finally {
      setBusy(false);
    }
  };

  const b = box && { x: left + box.x * k, y: top + box.y * k, w: box.w * k, h: (box.w / a) * k };
  const hole = b && (shape.round
    ? `radial-gradient(circle at ${b.x + b.w / 2}px ${b.y + b.h / 2}px, transparent ${b.w / 2}px, rgba(10, 11, 15, 0.68) ${b.w / 2 + 1}px)`
    : undefined);

  return (
    <Dialog.Root open={!!file} onOpenChange={(open) => !open && onDone(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="flex w-[40rem] max-w-[calc(100vw-2rem)] flex-col gap-3 p-4">
          <Dialog.Title className="text-lg">{shape.title}</Dialog.Title>
          <Dialog.Description className="text-xs text-gryt-muted">{shape.hint} {bestSize(shape)}</Dialog.Description>
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="relative shrink-0 touch-none overflow-hidden rounded-(--gryt-radius-lg) bg-gryt-surface select-none"
              style={{ width: FRAME_W, height: FRAME_H }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              {url && <img src={url} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left, top, width: W * k, height: H * k }} />}
              {b && box && (
                <>
                  {hole && <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: hole }} />}
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Picture framing. Arrow keys move it, plus and minus resize it."
                    aria-valuenow={Math.round((box.w / Math.min(W, H * a)) * 100)}
                    aria-valuemin={10}
                    aria-valuemax={100}
                    className="absolute cursor-move outline-offset-2 focus-visible:outline-2 focus-visible:outline-gryt-accent"
                    // A wide box dims what's outside it with its own shadow; the round one has the gradient above.
                    style={{ left: b.x, top: b.y, width: b.w, height: b.h, boxShadow: shape.round ? "inset 0 0 0 1px rgba(255, 255, 255, 0.55)" : "0 0 0 9999px rgba(10, 11, 15, 0.68), inset 0 0 0 2px rgba(255, 255, 255, 0.95)" }}
                    onPointerDown={start(null)}
                    onDoubleClick={() => img && setBox(initialBox(W, H, a))}
                    onKeyDown={onKey}
                  >
                    {shape.round && <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.95)" }} />}
                    {CORNERS.map((c) => (
                      <span
                        key={c}
                        aria-hidden="true"
                        title={`Resize from the ${CORNER_LABEL[c]}`}
                        className="absolute h-3.5 w-3.5 rounded-[3px] bg-white"
                        style={{
                          left: c.endsWith("w") ? -7 : undefined, right: c.endsWith("e") ? -7 : undefined,
                          top: c.startsWith("n") ? -7 : undefined, bottom: c.startsWith("s") ? -7 : undefined,
                          cursor: c === "nw" || c === "se" ? "nwse-resize" : "nesw-resize",
                        }}
                        onPointerDown={start(c)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
            {preview && shown && (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="text-[11px] font-bold tracking-wider text-gryt-muted uppercase">Your card</span>
                {preview(shown)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="small" tone="neutral" onClick={() => onDone(null)}>
              Cancel
            </Button>
            <Button size="small" disabled={!box || busy} onClick={() => void save()}>
              Use this
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
