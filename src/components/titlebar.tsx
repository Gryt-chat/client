import { useEffect } from "react";

import { isElectron } from "../lib/electron";
import { isMacOS, useWindowFocused } from "../lib/windowFrame";
import { MacWindowControls } from "./macWindowControls";
import { WindowControls } from "./windowControls";

export const TITLEBAR_HEIGHT = 36;

export function Titlebar() {
  const focused = useWindowFocused();

  useEffect(() => {
    if (isElectron()) {
      document.documentElement.style.setProperty("--titlebar-inset", `${TITLEBAR_HEIGHT}px`);
    }
  }, []);

  if (!isElectron()) return null;

  /* Each platform gets its own window buttons, not one drawing moved around
     (GRYT-626). macOS gets traffic lights on the left, measured off a real
     window; Windows and Linux get caption buttons on the right. Those are two
     different visual languages and people navigate both by muscle memory, so
     matching each is worth more than matching them to each other. */
  const mac = isMacOS();

  return (
    <div
      data-gryt="titlebar"
      /* Only when the titlebar itself was hit, never a child of it.
         Electron's draggable regions "ignore all pointer events", and that
         applies to children overlapping the region rather than to the region
         itself — so the drag element gets the dblclick and anything sitting
         on top of it silently gets nothing. A flex spacer used to cover this
         strip, which is why double-clicking did nothing at all: every real
         click landed on the spacer and was swallowed. Synthetic clicks bubble
         and so appeared to work, which is what made it hard to see. */
      onDoubleClick={(event) => {
        if (event.currentTarget !== event.target) return;
        window.electronAPI?.titlebarDoubleClick();
      }}
      style={{
        height: TITLEBAR_HEIGHT,
        appRegion: "drag",
        WebkitAppRegion: "drag",
        userSelect: "none",
        background: "var(--gryt-neutral-1)",
        borderBottom: "1px solid var(--gryt-neutral-a3)",
        flexShrink: 0,
        position: "relative",
        // Above the overlay band, so a modal cannot cover the window chrome.
        // -webkit-app-region is hit-tested against the topmost element at a
        // point, so a backdrop over this strip does not just blur it, it takes
        // the drag region and the back/forward buttons with it (GRYT-188).
        //
        // The rungs, and why chrome sits where it does, are in style.css.
        zIndex: "var(--gryt-z-chrome)",
        display: "flex",
        alignItems: "center",
      } as React.CSSProperties}
    >
      {mac && <MacWindowControls />}

      {/* Centered title */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <span
          style={{
            fontFamily: "var(--code-font-family)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--gryt-neutral-a9)",
            letterSpacing: 0.5,
          }}
        >
          gryt.chat
        </span>
      </div>

      {!mac && (
        <WindowControls
          order={["minimize", "maximize", "close"]}
          focused={focused}
          pushRight
        />
      )}
    </div>
  );
}
