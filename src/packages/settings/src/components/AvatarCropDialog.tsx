import { Button, Dialog } from "@gryt/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { type Box, type Corner, initialBox, moveBox, previewOf, renderAvatar, resizeBox, scaleBox } from "./avatarCrop";

const FRAME = 280;
const CORNERS: Corner[] = ["nw", "ne", "sw", "se"];
const CORNER_LABEL: Record<Corner, string> = { nw: "top left", ne: "top right", sw: "bottom left", se: "bottom right" };

/**
 * Frames a still picture for the avatar: the whole picture shows, the square on it is what's kept,
 * and the circle in the square is what people see. Drag moves it, a corner resizes it.
 */
export function AvatarCropDialog({ file, onDone, preview }: { file: File | null; onDone: (cropped: File | null) => void; preview?: (src: string) => ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ corner: Corner | null; x: number; y: number } | null>(null);

  useEffect(() => {
    setImg(null);
    setBox(null);
    if (!file) return setUrl(null);
    const next = URL.createObjectURL(file);
    setUrl(next);
    const el = new Image();
    el.onload = () => {
      setImg(el);
      setBox(initialBox(el.naturalWidth, el.naturalHeight));
    };
    el.onerror = () => {
      toast.error("Couldn't open that picture");
      onDone(null);
    };
    el.src = next;
    return () => URL.revokeObjectURL(next);
    // onDone changes every render of the parent; the picture only changes with the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // The card preview follows the box, a frame at a time.
  useEffect(() => {
    if (!img || !box || !preview) return;
    const id = requestAnimationFrame(() => setShown(previewOf(img, box)));
    return () => cancelAnimationFrame(id);
  }, [img, box, preview]);

  const w = img?.naturalWidth ?? 1, h = img?.naturalHeight ?? 1;
  // The picture fits the frame whole; k turns its pixels into the frame's.
  const k = Math.min(FRAME / w, FRAME / h);
  const left = (FRAME - w * k) / 2, top = (FRAME - h * k) / 2;
  const min = Math.min(w, h) * 0.1;

  const start = (corner: Corner | null) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { corner, x: e.clientX, y: e.clientY };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !img) return;
    const dx = (e.clientX - d.x) / k, dy = (e.clientY - d.y) / k;
    d.x = e.clientX;
    d.y = e.clientY;
    setBox((b) => b && (d.corner ? resizeBox(b, d.corner, dx, dy, w, h, min) : moveBox(b, dx, dy, w, h)));
  };
  const end = () => { drag.current = null; };

  const onKey = (e: React.KeyboardEvent) => {
    const step = (e.shiftKey ? 0.05 : 0.01) * Math.min(w, h);
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) setBox((b) => b && moveBox(b, ...moves[e.key], w, h));
    else if (e.key === "+" || e.key === "=") setBox((b) => b && scaleBox(b, step * 2, w, h, min));
    else if (e.key === "-") setBox((b) => b && scaleBox(b, -step * 2, w, h, min));
    else return;
    e.preventDefault();
  };

  const save = async () => {
    if (!img || !box) return;
    setBusy(true);
    try {
      onDone(await renderAvatar(img, box));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't crop the picture");
    } finally {
      setBusy(false);
    }
  };

  const b = box && { x: left + box.x * k, y: top + box.y * k, s: box.size * k };

  return (
    <Dialog.Root open={!!file} onOpenChange={(open) => !open && onDone(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="flex w-[37.5rem] max-w-[calc(100vw-2rem)] flex-col gap-3 p-4">
          <Dialog.Title className="text-lg">Frame your picture</Dialog.Title>
          <Dialog.Description className="text-xs text-gryt-muted">
            Drag the circle to move it, pull a corner to resize. The circle is what everyone sees.
          </Dialog.Description>
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="relative shrink-0 touch-none overflow-hidden rounded-(--gryt-radius-lg) bg-gryt-surface select-none"
              style={{ width: FRAME, height: FRAME }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
            >
              {url && <img src={url} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ left, top, width: w * k, height: h * k }} />}
              {b && (
                <>
                  <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at ${b.x + b.s / 2}px ${b.y + b.s / 2}px, transparent ${b.s / 2}px, rgba(10, 11, 15, 0.68) ${b.s / 2 + 1}px)` }} />
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Picture framing. Arrow keys move it, plus and minus resize it."
                    aria-valuenow={Math.round((box.size / Math.min(w, h)) * 100)}
                    aria-valuemin={10}
                    aria-valuemax={100}
                    className="absolute cursor-move outline-offset-2 focus-visible:outline-2 focus-visible:outline-gryt-accent"
                    style={{ left: b.x, top: b.y, width: b.s, height: b.s, boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.55)" }}
                    onPointerDown={start(null)}
                    onDoubleClick={() => img && setBox(initialBox(w, h))}
                    onKeyDown={onKey}
                  >
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.95)" }} />
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
