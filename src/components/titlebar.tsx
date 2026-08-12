import { useCallback, useEffect,useState } from "react";
import { PiCaretLeftFill, PiCaretRightFill } from "react-icons/pi";

import { isElectron } from "../lib/electron";

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

  const goBack = useCallback(() => window.history.back(), []);
  const goForward = useCallback(() => window.history.forward(), []);

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
        background: "var(--gryt-titlebar-bg)",
        borderBottom: "1px solid var(--gray-a3)",
        flexShrink: 0,
        position: "relative",
        // Above the overlay band, so a modal cannot cover the window chrome.
        // Dialog and Drawer backdrops are `fixed inset-0` portaled to body, and
        // neither sets a z-index, so DOM order alone put them on top of this:
        // the titlebar came out blurred, and because -webkit-app-region is
        // hit-tested against the topmost element, the drag region and the
        // back/forward buttons went with it.
        //
        // 10000 clears the overlays that do set one — the tour scrim at 9000,
        // the lightbox and debug overlay at 9999 — while staying under the
        // toasts (99999) and the auth splash (999999), which are deliberately
        // above everything.
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
      } as React.CSSProperties}
    >
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
            color: "var(--gray-a9)",
            letterSpacing: 0.5,
          }}
        >
          gryt.chat
        </span>
      </div>
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
        borderRadius: "var(--radius-2)",
        background: "transparent",
        color: disabled ? "var(--gray-a5)" : "var(--gray-a11)",
        cursor: disabled ? "default" : "pointer",
        transition: "background 0.1s, color 0.1s",
        opacity: disabled ? 0.4 : 1,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--gray-a3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

