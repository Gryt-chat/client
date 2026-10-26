import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import { MiniControls } from "@/webRTC/src/components/miniControls";

import { getElectronAPI } from "../../../../lib/electron";
import { PiArrowBendUpLeftBold, PiPushPinFill } from "../../../../lib/icons";
import type { CallWindow } from "../utils/popoutCall";

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
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5 text-xs font-bold">
        <span className="h-2 w-2 rounded-full" style={{ background: "var(--gryt-success-9)" }} />
        <span className="flex-1 truncate">{title}</span>
        {electron && (
          <button
            type="button"
            aria-label={pinned ? "Stop keeping on top" : "Keep on top of other windows"}
            aria-pressed={pinned}
            className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full border-0"
            style={pinned ? { background: "var(--gryt-accent-9)", color: "var(--gryt-neutral-1)" } : { background: "transparent", color: "var(--gryt-neutral-11)" }}
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
          aria-label="Put the call back in Gryt"
          className="flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-gryt-muted hover:bg-gryt-neutral-5"
          onClick={onReturn}
        >
          <PiArrowBendUpLeftBold size={13} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {children}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center transition-opacity duration-200"
          style={{ opacity: hover ? 1 : 0 }}
        >
          <div className="pointer-events-auto">
            <MiniControls direction="popout" />
          </div>
        </div>
      </div>
    </div>,
    callWindow.container,
  );
}
