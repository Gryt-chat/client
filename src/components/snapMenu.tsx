import { useEffect, useRef } from "react";

import type { SnapZone } from "../lib/electron";

/**
 * Where to put the window, drawn as the shape it will end up in (GRYT-626).
 *
 * Our own on every platform, because neither OS gives this away once the frame
 * is ours: Windows 11 hangs Snap Layouts off a native caption button through
 * WM_NCHITTEST, and macOS hangs its tiling menu off the native zoom button
 * with no hook at all. One menu on all three is both less work and the only
 * thing that can exist on macOS.
 *
 * Four tiles carrying nine actions, and not a word in any of them. Each tile
 * is a miniature of the screen and the region you click is the region the
 * window takes — the same idiom Windows uses, which reads faster than a list
 * of names and has nothing in it to translate.
 *
 * It is deliberately not @gryt/ui's Popover. Those portal to document.body,
 * and --gryt-z-popover (10) and --gryt-z-menu (35) both sit under
 * --gryt-z-chrome (70), so a portalled menu paints underneath the titlebar it
 * is supposed to hang from. This one lives inside the titlebar's own stacking
 * context instead.
 */

const TILES: { zones: SnapZone[]; cols: number; rows: number }[] = [
  { zones: ["fill"], cols: 1, rows: 1 },
  { zones: ["left", "right"], cols: 2, rows: 1 },
  { zones: ["top", "bottom"], cols: 1, rows: 2 },
  {
    zones: [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ],
    cols: 2,
    rows: 2,
  },
];

const LABEL: Record<SnapZone, string> = {
  fill: "Fill the screen",
  left: "Left half",
  right: "Right half",
  top: "Top half",
  bottom: "Bottom half",
  "top-left": "Top left quarter",
  "top-right": "Top right quarter",
  "bottom-left": "Bottom left quarter",
  "bottom-right": "Bottom right quarter",
};

export function SnapMenu({
  align,
  onDismiss,
  autoFocus,
  onMouseEnter,
  onMouseLeave,
}: {
  /** Which edge to hang from — the side its button is on. */
  align: "left" | "right";
  onDismiss: () => void;
  autoFocus?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;

    // Where focus goes back to on Escape. Falling to the body instead would
    // strand a keyboard user at the top of the document.
    const previous = document.activeElement;
    const menu = root.current;
    first.current?.focus();

    return () => {
      if (
        menu?.contains(document.activeElement) &&
        previous instanceof HTMLElement
      )
        previous.focus();
    };
  }, [autoFocus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () =>
      document.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  let index = 0;

  return (
    <div
      ref={root}
      className="gryt-snap-menu"
      role="group"
      aria-label="Snap the window"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{ [align]: 0 } as React.CSSProperties}
    >
      {TILES.map((tile, t) => (
        <div
          key={t}
          className="gryt-snap-tile"
          style={{
            gridTemplateColumns: `repeat(${tile.cols}, 1fr)`,
            gridTemplateRows: `repeat(${tile.rows}, 1fr)`,
          }}
        >
          {tile.zones.map((zone) => (
            <button
              key={zone}
              ref={index++ === 0 ? first : undefined}
              className="gryt-snap-region"
              aria-label={LABEL[zone]}
              title={LABEL[zone]}
              onClick={() => {
                window.electronAPI?.snapWindow(zone);
                onDismiss();
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
