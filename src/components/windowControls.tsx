import { useWindowState } from "../lib/windowFrame";

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

export function WindowControls({ order }: { order: WindowControl[] }) {
  const { maximized, fullScreen } = useWindowState();

  return (
    <div
      style={{
        display: "flex",
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
    </div>
  );
}

function ControlButton({
  label,
  hover,
  onClick,
  children,
}: {
  label: string;
  hover?: string;
  onClick: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
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
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--gryt-neutral-a11)";
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
