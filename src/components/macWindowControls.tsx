import { useWindowFocused, useWindowState } from "../lib/windowFrame";

/**
 * The macOS traffic lights, drawn (GRYT-626).
 *
 * Drawn rather than native because they cannot be both. `titleBarStyle:
 * "hidden"` keeps the real ones, but `transparent: true` takes them away, and
 * transparency is what lets us round the corners ourselves. Probed directly:
 * of four windows differing only in those options, the lights appear on the
 * opaque one and on none of the transparent ones.
 *
 * So the numbers below are measured off a real macOS 26 window rather than
 * taken from the values people quote, all in points at 2x:
 *
 *   diameter 14, centres at x 15.5 / 38.5 / 61.5 — so 23 apart
 *   flat fill, no gradient, with a half-point darker rim
 *   inactive: all three go to white at 17% over the titlebar
 *
 * The colours are calibrated rather than copied. `screencapture` puts pixels
 * through a colour transform — a window filled with #ff00ff reads back as
 * #e634f9 — so the published values (#FF5F57, #FEBC2E, #28C840) do not land on
 * the native pixels. These were found by rendering candidates beside the real
 * lights, measuring both through the same transform, and correcting until the
 * difference went to zero. Two of the three match exactly; the yellow is four
 * units of blue off, at the floor of what the transform can reach.
 *
 * One consequence worth knowing: that calibration was done in sRGB on this
 * display. Apple specifies its own lights in Display P3, so on a very
 * different monitor the two could drift slightly apart again.
 */

/** Measured, in points. */
const DIAMETER = 14;
const SPACING = 23;
const FIRST_CENTRE = 15.5;

type Light = "close" | "minimize" | "zoom";

const FILL: Record<Light, string> = {
  close: "#ff5b5e",
  minimize: "#fac70f",
  zoom: "#31c759",
};

const ORDER: Light[] = ["close", "minimize", "zoom"];

export function MacWindowControls() {
  const focused = useWindowFocused();
  const { fullScreen } = useWindowState();

  return (
    <div
      data-gryt="mac-window-controls"
      style={{
        position: "relative",
        alignSelf: "stretch",
        // Room for the group plus the right half of the last light.
        width: FIRST_CENTRE + SPACING * 2 + DIAMETER / 2,
        flexShrink: 0,
        appRegion: "no-drag",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      {ORDER.map((light, i) => (
        <TrafficLight
          key={light}
          light={light}
          centre={FIRST_CENTRE + i * SPACING}
          focused={focused}
          fullScreen={fullScreen}
        />
      ))}
    </div>
  );
}

function TrafficLight({
  light,
  centre,
  focused,
  fullScreen,
}: {
  light: Light;
  centre: number;
  focused: boolean;
  fullScreen: boolean;
}) {
  const api = window.electronAPI;

  const onClick = (event: React.MouseEvent) => {
    if (light === "close") return api?.closeWindow();
    if (light === "minimize") return api?.minimizeWindow();
    /* The green one is full screen on macOS, and Option makes it zoom. That is
       the opposite way round from the drawn button Windows and Linux get,
       where full screen is the rarer of the two and sits behind the modifier —
       each platform keeps its own habit. */
    return event.altKey
      ? api?.toggleMaximizeWindow()
      : api?.toggleFullScreenWindow();
  };

  return (
    <button
      onClick={onClick}
      aria-label={
        light === "close"
          ? "Close"
          : light === "minimize"
            ? "Minimise"
            : fullScreen
              ? "Leave full screen"
              : "Enter full screen"
      }
      className="gryt-traffic-light"
      style={{
        position: "absolute",
        left: centre - DIAMETER / 2,
        top: "50%",
        transform: "translateY(-50%)",
        width: DIAMETER,
        height: DIAMETER,
        padding: 0,
        borderRadius: "50%",
        border: "none",
        cursor: "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        /* Inactive is a translucent grey rather than a flat colour, so it
           lands correctly on a light theme too, where macOS also darkens
           rather than lightens. */
        background: focused
          ? FILL[light]
          : "var(--gryt-traffic-light-inactive)",
        boxShadow: focused
          ? "inset 0 0 0 0.5px rgba(0, 0, 0, 0.14)"
          : "none",
      }}
    >
      <svg
        width={DIAMETER}
        height={DIAMETER}
        viewBox="0 0 14 14"
        fill="none"
        stroke="rgba(0, 0, 0, 0.55)"
        strokeWidth="1.25"
        strokeLinecap="round"
        aria-hidden
        /* macOS reveals the glyphs on all three at once, when the pointer is
           anywhere over the group — not per button. The rule is in style.css
           because it hangs off the group's :hover. */
        className="gryt-traffic-light-glyph"
      >
        {light === "close" ? (
          <path d="M4.6 4.6l4.8 4.8M9.4 4.6l-4.8 4.8" />
        ) : light === "minimize" ? (
          <path d="M4 7h6" />
        ) : fullScreen ? (
          // Leaving full screen: the arrows point back in.
          <path
            d="M8.4 3.6v2h2M5.6 10.4v-2h-2"
            fill="rgba(0, 0, 0, 0.55)"
            stroke="rgba(0, 0, 0, 0.55)"
          />
        ) : (
          // Entering it: two triangles pushing out along the diagonal.
          <path
            d="M4 4h4.2L4 8.2zM10 10H5.8L10 5.8z"
            fill="rgba(0, 0, 0, 0.55)"
            stroke="none"
          />
        )}
      </svg>
    </button>
  );
}
