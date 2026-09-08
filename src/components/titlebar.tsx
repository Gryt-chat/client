import { useEffect } from "react";

import { isElectron } from "../lib/electron";

export const TITLEBAR_HEIGHT = 36;

export function Titlebar() {
  useEffect(() => {
    if (isElectron()) {
      document.documentElement.style.setProperty("--titlebar-inset", `${TITLEBAR_HEIGHT}px`);
    }
  }, []);

  if (!isElectron()) return null;

  return (
    <div
      data-gryt="titlebar"
      style={{
        height: TITLEBAR_HEIGHT,
        appRegion: "drag",
        WebkitAppRegion: "drag",
        userSelect: "none",
        background: "var(--gryt-neutral-1)",
        borderBottom: "1px solid var(--gryt-neutral-a3)",
        flexShrink: 0,
        position: "relative",
        // Above the overlay band, so a modal cannot cover the window chrome: a
        // backdrop over it takes the drag region with it (GRYT-188).
        zIndex: "var(--gryt-z-chrome)",
        display: "flex",
        alignItems: "center",
      } as React.CSSProperties}
    >
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
    </div>
  );
}
