import { useEffect } from "react";

import { useSnapMenu } from "../lib/snapMenu";
import { useWindowState } from "../lib/windowFrame";
import { SnapMenu } from "./snapMenu";

/**
 * Minimise, maximise and close, drawn rather than asked for (GRYT-626).
 *
 * The window is frameless on every platform, so no OS is painting these. The
 * actions behind them are still native — main calls Electron's own minimise,
 * maximise and close, and close still runs the close-to-tray handler.
 *
 * One set of buttons for all three platforms, because a window that looks the
 * same everywhere is the point. What does change per platform is which side
 * of the titlebar they sit on and the order within the group, which the
 * titlebar decides; both are conventions people navigate by muscle memory and
 * neither costs anything to honour.
 *
 * The glyphs are inline SVG rather than icons from the app's set. Caption
 * glyphs are their own visual language — 10px, single-weight strokes, drawn
 * on a pixel grid — and Phosphor at this size reads as a toolbar icon that
 * wandered into the wrong strip.
 */

const BUTTON_WIDTH = 46;

/** Windows 11's caption hover red, which is the one nobody has to be taught. */
const CLOSE_HOVER = "#e81123";

export type WindowControl = "minimize" | "maximize" | "close";

export function WindowControls({
  order,
  focused,
}: {
  order: WindowControl[];
  focused: boolean;
}) {
  const { maximized, fullScreen } = useWindowState();
  const snap = useSnapMenu();

  /* The window going to the background takes the menu with it, the same way
     every OS menu closes when you click away from its window.

     On snap.closeNow rather than on snap, and that is the whole point: snap
     changes identity the moment the menu opens, so depending on it re-runs
     this and shuts the menu again in the same breath. Closing has to happen
     on the transition out of focus, not for as long as focus is elsewhere —
     hovering a background window's buttons is allowed, and Windows shows
     Snap Layouts there too. */
  const { closeNow } = snap;
  useEffect(() => {
    if (!focused) closeNow();
  }, [focused, closeNow]);

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        alignSelf: "stretch",
        appRegion: "no-drag",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      {order.map((control) =>
        control === "minimize" ? (
          <ControlButton
            key={control}
            label="Minimise"
            onClick={() => window.electronAPI?.minimizeWindow()}
          >
            <path d="M1 5.5h9" />
          </ControlButton>
        ) : control === "maximize" ? (
          <ControlButton
            key={control}
            label={
              maximized || fullScreen
                ? "Restore"
                : "Maximise"
            }
            /* Alt is the macOS convention the other way round — there the
               green button is full screen and Option makes it zoom. Full
               screen is the rarer of the two on a window this size, so it is
               the one behind the modifier. */
            onClick={(event) =>
              event.altKey
                ? window.electronAPI?.toggleFullScreenWindow()
                : window.electronAPI?.toggleMaximizeWindow()
            }
            /* Dwelling here opens the snap menu, which is where Windows 11
               puts Snap Layouts. Ours is drawn rather than native, so it is
               the same gesture on Linux too. */
            onMouseEnter={snap.openAfterDwell}
            onMouseLeave={snap.closeAfterGrace}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                snap.openByKeyboard();
              }
            }}
          >
            {maximized || fullScreen ? (
              <>
                <path d="M3 3.5V1.5h7.5V9h-2" />
                <rect x="1" y="3.5" width="7.5" height="7" />
              </>
            ) : (
              <rect x="1" y="1" width="9" height="9" />
            )}
          </ControlButton>
        ) : (
          <ControlButton
            key={control}
            label="Close"
            hover={CLOSE_HOVER}
            onClick={() => window.electronAPI?.closeWindow()}
          >
            <path d="M1 1l9 9M10 1l-9 9" />
          </ControlButton>
        )
      )}

      {snap.open && (
        <SnapMenu
          align="right"
          autoFocus={snap.openedByKeyboard}
          onMouseEnter={snap.openNow}
          onMouseLeave={snap.closeAfterGrace}
          onDismiss={snap.closeNow}
        />
      )}
    </div>
  );
}

function ControlButton({
  label,
  hover,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onKeyDown,
  children,
}: {
  label: string;
  hover?: string;
  onClick: (event: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onKeyDown={onKeyDown}
      aria-label={label}
      title={label}
      style={{
        width: BUTTON_WIDTH,
        alignSelf: "stretch",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        borderRadius: 0,
        background: "transparent",
        color: "var(--gryt-neutral-a11)",
        cursor: "default",
        padding: 0,
        transition: "background 0.1s, color 0.1s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          hover ?? "var(--gryt-neutral-a3)";
        if (hover) e.currentTarget.style.color = "#fff";
        onMouseEnter?.();
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--gryt-neutral-a11)";
        onMouseLeave?.();
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 11 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  );
}
