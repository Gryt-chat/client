
import { computeGridLayout, GRID_GAP } from "@/socket/src/lib/voiceLayout";

import type { VoiceTileLayout } from "../hooks/settingsStorage";

/**
 * The size the arrangement is worked out at, before being scaled into the
 * swatch.
 *
 * Asking computeGridLayout for a 132px-wide grid would not answer the question
 * being asked: MIN_TILE_WIDTH is 140, so every rule collapses to the same
 * degenerate single column and both previews would look identical. Computing at
 * a realistic panel size and scaling the result down keeps the arrangement
 * honest.
 */
const REFERENCE = { width: 880, height: 495 };

/** Nine, because it is where the two rules visibly disagree. */
const SAMPLE_COUNT = 9;

const SWATCH = { width: 132, height: 74 };

/**
 * What a layout rule actually does, drawn from the layout code itself.
 *
 * Deliberately not a hand-drawn picture: this is the same function the voice
 * grid runs, so the swatch cannot drift away from what you get on screen when
 * somebody changes the packing rules.
 */
function LayoutSwatch({ rule }: { rule: VoiceTileLayout }) {
  const layout = computeGridLayout(
    REFERENCE.width,
    REFERENCE.height,
    SAMPLE_COUNT,
    rule,
  );

  // Scaled to fit, gaps included. Scaling by width alone overflows: the Meet
  // rule puts five tiles in its second row, which comes to more than the
  // swatch is wide once the gaps between them are counted.
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
        background: "var(--gray-3)",
        borderRadius: "var(--radius-2)",
      }}>
      {layout.rows.map((row, rowIndex) => (
        <div className="flex justify-center" key={rowIndex} style={{ gap }}>
          {Array.from({ length: row.count }, (_, i) => (
            <div
              key={i}
              style={{
                width: Math.max(2, row.width * scale),
                height: Math.max(2, row.height * scale),
                background: "var(--accent-9)",
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
 * Pick a layout by looking at it.
 *
 * It used to be two radio labels and a paragraph each describing what happens
 * to nine people, so you had to read it, picture it, choose, and then go and
 * look. The pictures are of nine people, which is the count the descriptions
 * were describing.
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
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              style={{
                cursor: "pointer",
                padding: 8,
                borderRadius: "var(--radius-3)",
                background: selected ? "var(--accent-a3)" : "transparent",
                border: selected
                  ? "1px solid var(--accent-8)"
                  : "1px solid var(--gray-6)",
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
