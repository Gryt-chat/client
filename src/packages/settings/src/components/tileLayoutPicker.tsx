
import { computeGridLayout, GRID_GAP } from "@/socket/src/lib/voiceLayout";

import type { VoiceTileLayout } from "../hooks/settingsStorage";

/**
 * The size the arrangement is worked out at, before being scaled into the swatch.
 * At 132px MIN_TILE_WIDTH collapses every rule to one column.
 */
const REFERENCE = { width: 880, height: 495 };

/** Nine, because it is where the two rules visibly disagree. */
const SAMPLE_COUNT = 9;

const SWATCH = { width: 132, height: 74 };

/**
 * What a layout rule actually does, drawn from the layout code itself — the same
 * function the voice grid runs, so the swatch cannot drift.
 */
function LayoutSwatch({ rule }: { rule: VoiceTileLayout }) {
  const layout = computeGridLayout(
    REFERENCE.width,
    REFERENCE.height,
    SAMPLE_COUNT,
    rule,
  );

  // Scaled to fit, gaps included. Scaling by width alone overflows: the Meet rule
  // puts five tiles in its second row, wider than the swatch once gapped.
  const naturalWidth = Math.max(
    ...layout.rows.map((r) => r.count * r.width + (r.count - 1) * GRID_GAP),
  );
  const naturalHeight =
    layout.rows.reduce((sum, r) => sum + r.height, 0) +
    (layout.rows.length - 1) * GRID_GAP;

  const inner = { width: SWATCH.width - 12, height: SWATCH.height - 12 };
  const scale = Math.min(
    inner.width / naturalWidth,
    inner.height / naturalHeight,
  );
  const gap = Math.max(1, GRID_GAP * scale);

  return (
    <div className="flex flex-col items-center justify-center" style={{
        width: SWATCH.width,
        height: SWATCH.height,
        gap,
        background: "var(--gryt-neutral-3)",
        borderRadius: "var(--gryt-radius-sm)",
      }}>
      {layout.rows.map((row, rowIndex) => (
        <div className="flex justify-center" key={rowIndex} style={{ gap }}>
          {Array.from({ length: row.count }, (_, i) => (
            <div
              key={i}
              style={{
                width: Math.max(2, row.width * scale),
                height: Math.max(2, row.height * scale),
                background: "var(--gryt-accent-9)",
                borderRadius: 2,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const OPTIONS: Array<{
  value: VoiceTileLayout;
  label: string;
  hint: string;
}> = [
  {
    value: "meet",
    label: "Match Google Meet",
    hint: "More columns, and tiles may go tall and narrow.",
  },
  {
    value: "large",
    label: "Biggest tiles",
    hint: "Whichever arrangement makes the tiles largest.",
  },
];

/**
 * Pick a layout by looking at it. It used to be two radio labels and a paragraph
 * each about nine people, which is the count the pictures show.
 */
export function TileLayoutPicker({
  value,
  onChange,
}: {
  value: VoiceTileLayout;
  onChange: (layout: VoiceTileLayout) => void;
}) {
  return (
    <div className="flex gap-3 flex-wrap" role="radiogroup" aria-label="Tile layout">
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button className="flex flex-col gap-2 items-center"
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              style={{
                cursor: "pointer",
                padding: 8,
                borderRadius: "var(--gryt-radius-md)",
                background: selected ? "var(--gryt-accent-a3)" : "transparent",
                border: selected
                  ? "1px solid var(--gryt-accent-8)"
                  : "1px solid var(--gryt-neutral-6)",
                font: "inherit",
                color: "inherit",
                textAlign: "center",
                maxWidth: 160,
              }}
            >
              <LayoutSwatch rule={option.value} />
              <span className={`text-xs ${selected ? "font-bold" : "font-normal"}`}>
                {option.label}
              </span>
              {/* The prose stays, under the picture rather than instead of it,
                  so this is still readable to a screen reader. */}
              <span className="text-xs text-gryt-muted">
                {option.hint}
              </span>
            </button>
        );
      })}
    </div>
  );
}
