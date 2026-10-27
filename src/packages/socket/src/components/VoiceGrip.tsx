import { type RefObject, useRef, useState } from "react";

import { draggedVoiceStop, nextVoiceStop, voiceDragWidth, voicePresets, type VoiceStop } from "../lib/voiceGrip";

interface VoiceGripProps {
  /** The middle area the voice view and the chat share. */
  containerRef: RefObject<HTMLDivElement | null>;
  room: number;
  stop: VoiceStop;
  onStop: (stop: VoiceStop) => void;
  onResizing: (resizing: boolean) => void;
}

const DRAG_THRESHOLD_PX = 3;

/** The stops a drag can land on, with where each puts the grip and what it's called. */
function stopMarks(room: number): Array<{ stop: VoiceStop; x: number; label: string }> {
  const presets = voicePresets(room);
  return [
    { stop: "hidden", x: 0, label: "Hidden" },
    ...(presets
      ? [
          { stop: presets[0], x: presets[0], label: "Preset 1" },
          { stop: "preset2" as const, x: presets[1], label: "Preset 2" },
        ]
      : []),
    { stop: "full", x: room, label: "Full" },
  ];
}

/** Sits in the gap after the voice view. Drag it anywhere; on release it lands on the nearest stop. */
export function VoiceGrip({ containerRef, room, stop, onStop, onResizing }: VoiceGripProps) {
  // The room is taken once per drag: widening the call folds the member list, which widens the room under the pointer.
  const drag = useRef<{ startX: number; moved: boolean; room: number } | null>(null);
  const [target, setTarget] = useState<VoiceStop | null>(null);
  const marks = stopMarks(drag.current?.room ?? room);

  // The grip sits in the middle of the 16px gap after the panel.
  const xIn = (clientX: number) => clientX - (containerRef.current?.getBoundingClientRect().left ?? 0) - 8;
  const step = (by: 1 | -1) => {
    const at = marks.findIndex((m) => m.stop === (typeof stop === "number" ? draggedVoiceStop(stop, room) : stop));
    const next = marks[Math.max(0, Math.min(marks.length - 1, at + by))];
    if (next) onStop(next.stop);
  };

  return (
    <>
      {target !== null && (
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ zIndex: 3 }}>
          {marks.map((m) => {
            const on = m.stop === target;
            const left = Math.max(2, Math.min((drag.current?.room ?? room) - 2, m.x + 8));
            return (
              <div key={m.label} className="absolute top-0 bottom-0" style={{ left, width: 2, borderRadius: 1, background: on ? "var(--gryt-accent)" : "var(--gryt-neutral-7)" }}>
                <span
                  className="absolute whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-extrabold"
                  style={{
                    top: "calc(50% - 120px)",
                    ...(m.stop === "full" ? { right: 8 } : { left: 8 }),
                    background: on ? "var(--gryt-accent)" : "var(--gryt-neutral-5)",
                    color: on ? "var(--color-gryt-on-accent)" : "var(--gryt-neutral-11)",
                  }}
                >
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ position: "relative", width: 0, flexShrink: 0, zIndex: 2 }}>
        <button
          type="button"
          data-gryt="voice-grip"
          aria-label="Voice view size: drag, or use the arrow keys"
          title="Drag to resize"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { startX: e.clientX, moved: false, room };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return;
            if (!d.moved) onResizing(true);
            d.moved = true;
            onStop(voiceDragWidth(xIn(e.clientX), d.room));
            setTarget(draggedVoiceStop(xIn(e.clientX), d.room));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) {
              onStop(draggedVoiceStop(xIn(e.clientX), d.room));
              onResizing(false);
              setTarget(null);
            }
          }}
          onPointerCancel={() => {
            if (drag.current?.moved) {
              onStop(typeof stop === "number" ? draggedVoiceStop(stop, room) : stop);
              onResizing(false);
            }
            setTarget(null);
            drag.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(1);
            else if (e.key === "ArrowLeft") step(-1);
            else if (e.key === "Enter" || e.key === " ") onStop(nextVoiceStop(stop, room));
            else return;
            e.preventDefault();
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: stop === "full" ? -3 : -19,
            transform: "translateY(-50%)",
            width: 22,
            height: 56,
            borderRadius: 11,
            background: "var(--gryt-neutral-5)",
            border: "1px solid var(--gryt-neutral-7)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            padding: 0,
            cursor: target !== null ? "grabbing" : "grab",
            touchAction: "none",
          }}
        >
          {[0, 1, 2].map((i) => (
            <span key={i} aria-hidden style={{ width: 4, height: 4, borderRadius: 2, background: "var(--gryt-neutral-10)" }} />
          ))}
        </button>
      </div>
    </>
  );
}
