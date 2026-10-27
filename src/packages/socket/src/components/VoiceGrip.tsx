import { Tooltip } from "@gryt/ui";
import { type RefObject, useRef, useState } from "react";

import { PiArrowsOutBold, PiEyeSlashBold } from "../../../../lib/icons";
import { draggedVoiceStop, nextVoiceStop, voicePresets, type VoiceStop } from "../lib/voiceGrip";

interface VoiceGripProps {
  /** The middle area the voice view and the chat share. */
  containerRef: RefObject<HTMLDivElement | null>;
  room: number;
  stop: VoiceStop;
  onStop: (stop: VoiceStop) => void;
  onResizing: (resizing: boolean) => void;
}

const DRAG_THRESHOLD_PX = 3;

function Dot({ on, hidden }: { on: boolean; hidden: boolean }) {
  const size = on ? 8 : 6;
  let background = hidden ? "transparent" : "var(--gryt-accent-7)";
  if (on) background = "var(--gryt-accent-9)";
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        boxSizing: "border-box",
        background,
        border: hidden ? "1.5px solid var(--gryt-accent-7)" : "none",
      }}
    />
  );
}

/** Sits in the gap after the voice view. Click cycles the stops, drag sets a width and snaps to them. */
export function VoiceGrip({ containerRef, room, stop, onStop, onResizing }: VoiceGripProps) {
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const presets = voicePresets(room);
  const hidden = stop === "hidden";
  const iconColor = (on: boolean) => (on ? "var(--gryt-accent-9)" : "var(--gryt-accent-8)");
  const [dragging, setDragging] = useState(false);
  const gripLeft = stop === "full" ? -3 : -19;
  let snapLabel: string | null = null;
  if (stop === "hidden") snapLabel = "Hidden";
  else if (stop === "full") snapLabel = "Full";
  else if (stop === "preset2") snapLabel = "Preset 2";
  else if (presets && stop === presets[0]) snapLabel = "Preset 1";

  const stopAt = (clientX: number) => {
    const left = containerRef.current?.getBoundingClientRect().left ?? 0;
    // The grip sits in the middle of the 16px gap after the panel.
    return draggedVoiceStop(clientX - left - 8, room);
  };

  return (
    <div style={{ position: "relative", width: 0, flexShrink: 0, zIndex: 2 }}>
      {dragging && snapLabel && (
        <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: gripLeft + 10, width: 2, borderRadius: 1, background: "var(--gryt-accent)", opacity: 0.9, pointerEvents: "none" }}>
          <span
            className="absolute whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-extrabold"
            style={{ top: "calc(50% - 120px)", ...(stop === "full" ? { right: 8 } : { left: 8 }), background: "var(--gryt-accent)", color: "var(--color-gryt-on-accent)" }}
          >
            {snapLabel}
          </span>
        </div>
      )}
      <Tooltip title="Drag to resize, click to cycle sizes">
        <button
          type="button"
          data-gryt="voice-grip"
          aria-label="Voice view size"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { startX: e.clientX, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) return;
            if (!d.moved) {
              onResizing(true);
              setDragging(true);
            }
            d.moved = true;
            onStop(stopAt(e.clientX));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            dragged.current = !!d?.moved;
            if (d?.moved) {
              onStop(stopAt(e.clientX));
              onResizing(false);
              setDragging(false);
            }
          }}
          onPointerCancel={() => {
            if (drag.current?.moved) onResizing(false);
            setDragging(false);
            drag.current = null;
          }}
          onClick={() => {
            if (dragged.current) {
              dragged.current = false;
              return;
            }
            onStop(nextVoiceStop(stop, room));
          }}
          style={{
            position: "absolute",
            top: "50%",
            left: gripLeft,
            transform: "translateY(-50%)",
            width: 22,
            height: presets ? 132 : 76,
            borderRadius: 11,
            background: "var(--gryt-neutral-5)",
            border: "1px solid var(--gryt-accent-6)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 0,
            cursor: "ew-resize",
            touchAction: "none",
          }}
        >
          <PiEyeSlashBold size={12} color={iconColor(hidden)} aria-hidden />
          {presets && (
            <>
              <Dot on={stop === presets[0]} hidden={hidden} />
              <Dot on={stop === "preset2"} hidden={hidden} />
            </>
          )}
          <PiArrowsOutBold size={12} color={iconColor(stop === "full")} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
