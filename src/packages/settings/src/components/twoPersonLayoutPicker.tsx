import {
  computeGridLayout,
  GRID_GAP,
  PIP_HEIGHT,
  PIP_INSET,
  PIP_WIDTH,
} from "@/socket/src/lib/voiceLayout";

import type { VoiceTileLayout, VoiceTwoPersonLayout } from "../hooks/settingsStorage";

/**
 * Maximised proportions, which is where the two arrangements differ most.
 *
 * In the sidebar the equal layout stacks and the hero layout still has a
 * corner tile, so both are legible either way — but the side-by-side is the
 * thing somebody is choosing between, so that is what the swatch shows.
 */
const REFERENCE = { width: 880, height: 495 };

const SWATCH = { width: 132, height: 74 };

const PADDING = 12;

/**
 * The arrangement, drawn from the layout code rather than by hand.
 *
 * Same reasoning as `LayoutSwatch` in the tile layout picker: this runs the
 * function the voice grid runs, so the picture cannot drift away from what you
 * get on screen.
 */
function TwoPersonSwatch({
  layout,
  rule,
}: {
  layout: VoiceTwoPersonLayout;
  rule: VoiceTileLayout;
}) {
  const inner = {
    width: SWATCH.width - PADDING,
    height: SWATCH.height - PADDING,
  };

  const frame = {
    width: SWATCH.width,
    height: SWATCH.height,
    background: "var(--gryt-neutral-3)",
    borderRadius: "var(--gryt-radius-sm)",
  } as const;

  const tile = {
    background: "var(--gryt-accent-9)",
    borderRadius: 2,
  } as const;

  if (layout === "hero") {
    const hero = computeGridLayout(
      REFERENCE.width,
      REFERENCE.height,
      1,
      rule,
    ).rows[0];

    if (!hero) return <div style={frame} />;

    const scale = Math.min(inner.width / hero.width, inner.height / hero.height);

    return (
      <div className="flex items-center justify-center" style={frame}>
        <div
          style={{
            position: "relative",
            width: hero.width * scale,
            height: hero.height * scale,
            ...tile,
          }}
        >
          <div
            style={{
              position: "absolute",
              right: PIP_INSET * scale,
              bottom: PIP_INSET * scale,
              width: Math.max(2, PIP_WIDTH * scale),
              height: Math.max(2, PIP_HEIGHT * scale),
              ...tile,
              // Against the hero rather than the panel, and ringed in the
              // swatch background, which is the only way to see it at this
              // size.
              background: "var(--gryt-accent-11)",
              boxShadow: "0 0 0 1px var(--gryt-neutral-3)",
            }}
          />
        </div>
      </div>
    );
  }

  const row = computeGridLayout(REFERENCE.width, REFERENCE.height, 2, rule)
    .rows[0];

  if (!row) return <div style={frame} />;

  const naturalWidth = row.count * row.width + (row.count - 1) * GRID_GAP;
  const scale = Math.min(inner.width / naturalWidth, inner.height / row.height);

  return (
    <div className="flex items-center justify-center" style={frame}>
      <div className="flex" style={{ gap: Math.max(1, GRID_GAP * scale) }}>
        {Array.from({ length: row.count }, (_, i) => (
          <div
            key={i}
            style={{
              width: Math.max(2, row.width * scale),
              height: Math.max(2, row.height * scale),
              ...tile,
            }}
          />
        ))}
      </div>
    </div>
  );
}

const OPTIONS: Array<{
  value: VoiceTwoPersonLayout;
  label: string;
  hint: string;
}> = [
  {
    value: "hero",
    label: "One large, one small",
    hint: "The other person fills the panel, you sit in the corner.",
  },
  {
    value: "equal",
    label: "Same size",
    hint: "Stacked in the sidebar, side by side once there is room.",
  },
];

/**
 * Which of the two arrangements a one-to-one call uses.
 *
 * Both are defensible — hero plus corner is what most video callers do and
 * gives the other person more pixels; equal tiles are better when you are both
 * doing something rather than talking — which is the argument for a choice
 * rather than a hardcoded answer.
 */
export function TwoPersonLayoutPicker({
  value,
  onChange,
  rule,
}: {
  value: VoiceTwoPersonLayout;
  onChange: (layout: VoiceTwoPersonLayout) => void;
  rule: VoiceTileLayout;
}) {
  return (
    <div
      className="flex gap-3 flex-wrap"
      role="radiogroup"
      aria-label="Two-person layout"
    >
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            className="flex flex-col gap-2 items-center"
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
            <TwoPersonSwatch layout={option.value} rule={rule} />
            <span className={`text-xs ${selected ? "font-bold" : "font-normal"}`}>
              {option.label}
            </span>
            <span className="text-xs text-gryt-muted">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
