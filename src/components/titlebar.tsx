import { useCallback, useEffect, useState } from "react";
import { PiCaretLeftFill, PiCaretRightFill } from "react-icons/pi";

import { isElectron } from "../lib/electron";
import { isMacOS, useWindowFocused } from "../lib/windowFrame";
import { MacWindowControls } from "./macWindowControls";
import { WindowControls } from "./windowControls";

export const TITLEBAR_HEIGHT = 36;

export function Titlebar() {
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  useEffect(() => {
    const update = () => {
      setCanGoBack(window.history.length > 1 && window.history.state !== null);
      setCanGoForward(false);
    };
    window.addEventListener("popstate", update);
    update();
    return () => window.removeEventListener("popstate", update);
  }, []);

  const focused = useWindowFocused();

  const goBack = useCallback(() => window.history.back(), []);
  const goForward = useCallback(() => window.history.forward(), []);

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
      /* What the OS does with a double-click on its own titlebar. There is no
         OS titlebar any more, so it has to be done here. */
      onDoubleClick={() => window.electronAPI?.toggleMaximizeWindow()}
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

      {/* Back / Forward */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          appRegion: "no-drag",
          WebkitAppRegion: "no-drag",
          paddingLeft: 10,
        } as React.CSSProperties}
      >
        <NavButton onClick={goBack} disabled={!canGoBack} label="Go back">
          <PiCaretLeftFill size={18} />
        </NavButton>
        <NavButton onClick={goForward} disabled={!canGoForward} label="Go forward">
          <PiCaretRightFill size={18} />
        </NavButton>
      </div>

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

      <div style={{ flex: 1 }} />

      {!mac && (
        <WindowControls
          order={["minimize", "maximize", "close"]}
          focused={focused}
        />
      )}
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 24,
        border: "none",
        borderRadius: "var(--gryt-radius-sm)",
        background: "transparent",
        color: disabled ? "var(--gryt-neutral-a5)" : "var(--gryt-neutral-a11)",
        cursor: disabled ? "default" : "pointer",
        transition: "background 0.1s, color 0.1s",
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--gryt-neutral-a3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
