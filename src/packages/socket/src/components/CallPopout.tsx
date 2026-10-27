import { type CSSProperties, type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { MiniControls } from "@/webRTC/src/components/miniControls";

import { getElectronAPI } from "../../../../lib/electron";
import { PiPushPinFill, PiXBold } from "../../../../lib/icons";
import type { CallWindow } from "../utils/popoutCall";

const DRAG = { appRegion: "drag", WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG = { appRegion: "no-drag", WebkitAppRegion: "no-drag" } as CSSProperties;

/** The call in its own window, as on the Popout board: title bar, the call, and plain toggles on hover. */
export function CallPopout({ callWindow, onReturn, children }: {
  callWindow: CallWindow;
  onReturn: () => void;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const electron = getElectronAPI();
  const { title } = callWindow;

  return createPortal(
    <div
      className="flex h-full flex-col overflow-hidden text-gryt-text"
      style={{ background: "var(--gryt-neutral-2)", border: `1px solid ${pinned ? "var(--gryt-accent-9)" : "var(--gryt-neutral-6)"}` }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {/* The window is frameless, so this bar is what it's dragged by. */}
      <div
        className="flex h-[34px] shrink-0 select-none items-center gap-2 border-b border-gryt-neutral-5 pl-3 pr-2 text-[13px] font-extrabold"
        style={DRAG}
      >
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--gryt-success-9)" }} />
        <span className="flex-1 truncate">{title}</span>
        {electron && (
          <button
            type="button"
            aria-label={pinned ? "Stop keeping on top" : "Keep on top of other windows"}
            aria-pressed={pinned}
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full border-0"
            style={{ ...NO_DRAG, ...(pinned ? { background: "var(--gryt-accent-9)", color: "var(--gryt-neutral-1)" } : { background: "transparent", color: "var(--gryt-neutral-11)" }) }}
            onClick={() => {
              electron.toggleAlwaysOnTop(!pinned, title);
              setPinned(!pinned);
            }}
          >
            <PiPushPinFill size={13} />
          </button>
        )}
        <button
          type="button"
          aria-label="Close, and put the call back in Gryt"
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-gryt-muted hover:bg-gryt-neutral-5"
          style={NO_DRAG}
          onClick={onReturn}
        >
          <PiXBold size={13} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {children}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-3.5 flex justify-center transition-[opacity,transform] duration-200"
          style={{ opacity: hover ? 1 : 0, transform: hover ? "none" : "translateY(10px)" }}
        >
          <div className={hover ? "pointer-events-auto" : undefined}>
            <MiniControls direction="popout" />
          </div>
        </div>
      </div>
    </div>,
    callWindow.container,
  );
}
