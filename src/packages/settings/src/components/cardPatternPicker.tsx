import { Button, Select } from "@gryt/ui";
import { type CSSProperties, lazy, Suspense, useEffect, useMemo, useState } from "react";

import { usePatternAssets } from "../../../socket/src/components/memberCard/patternAssets";
import { type CardStyle, PATTERN_FADES, type PatternFade, TUNING } from "../../../socket/src/lib/memberCard/cardStyle";
import { cardVars } from "../../../socket/src/lib/memberCard/cardVars";
import { GRYT_MARK } from "../../../socket/src/lib/memberCard/grytMark";
import { CARD_PATTERNS, cardPattern, isTunable, PATTERN_GROUPS } from "../../../socket/src/lib/memberCard/patterns";
import type { Tile } from "../../../socket/src/lib/memberCard/patterns/tileTypes";
import { patternLayers,type PatternMark } from "../../../socket/src/lib/memberCard/patternSvg";

const IconPicker = lazy(() => import("./cardIconPicker"));

const FADE_LABEL: Record<PatternFade, string> = {
  none: "No fade",
  top: "Fade to the top",
  bottom: "Fade to the bottom",
  left: "Fade to the left",
  right: "Fade to the right",
  radial: "Fade to the edges",
};

interface PickerProps {
  style: CardStyle;
  owlHex: string;
  nickname: string;
  worn: string | null;
  seed: number;
  appearance: "light" | "dark";
  onPick: (over: Partial<CardStyle>) => void;
}

/**
 * Every pattern as a swatch in your card's own colours, under its heading. The tiles
 * load in one go the first time this opens; scatter swatches use the mark they strew.
 */
export function PatternPicker({ style, owlHex, nickname, worn, seed, appearance, onPick }: PickerProps) {
  const [tiles, setTiles] = useState<Map<string, Tile> | null>(null);
  const icon = usePatternAssets({ ...style, pattern: "icon" }, { nickname, worn }).mark;
  const owl = usePatternAssets({ ...style, pattern: "my-owl" }, { nickname, worn }).mark;

  useEffect(() => {
    let live = true;
    void import("../../../socket/src/lib/memberCard/patterns/tiles.generated").then((m) => {
      if (live) setTiles(new Map(m.TILES.map((t) => [t.id, t])));
    });
    return () => {
      live = false;
    };
  }, []);

  /* The card's colours once; each swatch only swaps the pattern layer. */
  const card = useMemo(() => cardVars({ ...style, pattern: "none", pFade: "none" }, owlHex, { appearance, seed }), [style, owlHex, appearance, seed]);
  const ground = card.vars["--fc-bg"] ?? card.vars["--base"] ?? owlHex;

  const marks: Record<string, PatternMark | undefined> = { "gryt-faces": { ...GRYT_MARK, mono: false }, "my-owl": owl, icon };

  return (
    <div className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-(--gryt-radius-md) border border-gryt-border p-2.5">
      {PATTERN_GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-gryt-muted">{group}</span>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
            {CARD_PATTERNS.filter((p) => p.group === group).map((p) => {
              const layers = patternLayers(
                p.id,
                {
                  ink: card.patternInk,
                  // Stronger than on the card, so a 56px swatch still shows its pattern.
                  alpha: Math.max(card.patternAlpha, 0.35),
                  // Scattered marks are drawn smaller, or a 56px swatch holds one of them.
                  scale: p.kind === "scatter" ? 0.45 : 0.8,
                  rotate: 0,
                  fade: "none",
                  seed,
                  tile: tiles?.get(p.id),
                  mark: marks[p.id],
                },
                { owl: owlHex, accent: card.patternInk, surface: card.vars["--fc-mid"] ?? owlHex },
              );
              const picked = style.pattern === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  aria-pressed={picked}
                  onClick={() => onPick({ pattern: p.id })}
                  className="h-10 cursor-pointer rounded-(--gryt-radius-sm) border-0 p-0"
                  style={
                    {
                      background: [layers.image, layers.base ?? ground].filter(Boolean).join(", "),
                      boxShadow: picked ? "0 0 0 2px var(--gryt-surface), 0 0 0 4px var(--gryt-text)" : "inset 0 0 0 1px var(--gryt-border)",
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function Range({
  id,
  label,
  min,
  max,
  value,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label htmlFor={id} className="w-20 text-xs font-bold text-gryt-muted">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 120, accentColor: "var(--gryt-accent)" }}
      />
      <output className="min-w-[3.5em] font-mono text-xs text-gryt-muted">
        {value}
        {unit}
      </output>
    </div>
  );
}

/** Size, turn, strength, fade, shuffle and colour, for a pattern that draws lines or marks. */
export function PatternTuning({
  style,
  effectiveInk,
  effectiveAlpha,
  onChange,
}: {
  style: CardStyle;
  effectiveInk: string;
  effectiveAlpha: number;
  onChange: (over: Partial<CardStyle>) => void;
}) {
  const pattern = cardPattern(style.pattern);
  if (!isTunable(pattern.id)) return null;
  const strength = Math.round(effectiveAlpha * 100);
  const limited = style.pOpacity !== undefined && strength < style.pOpacity;
  return (
    <div className="flex flex-col gap-2.5">
      {pattern.id === "icon" && (
        <Suspense fallback={<span className="text-xs text-gryt-muted">Loading icons…</span>}>
          <IconPicker value={style.pIcon} onPick={(name) => onChange({ pIcon: name })} />
        </Suspense>
      )}
      <Range id="p-scale" label="Size" min={TUNING.pScale.min} max={TUNING.pScale.max} value={style.pScale} unit="%" onChange={(v) => onChange({ pScale: v })} />
      <Range id="p-rotate" label="Rotation" min={TUNING.pRotate.min} max={TUNING.pRotate.max} value={style.pRotate} unit="°" onChange={(v) => onChange({ pRotate: v })} />
      <Range
        id="p-opacity"
        label="Strength"
        min={TUNING.pOpacity.min}
        max={TUNING.pOpacity.max}
        value={Math.min(TUNING.pOpacity.max, Math.max(TUNING.pOpacity.min, style.pOpacity ?? strength))}
        unit="%"
        onChange={(v) => onChange({ pOpacity: v })}
      />
      {limited && <span className="text-xs text-gryt-muted">Held at {strength}% so the small text on your card stays readable.</span>}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="w-20 text-xs font-bold text-gryt-muted">Fade</span>
        <div className="min-w-40 flex-1">
          <Select
            value={style.pFade}
            onValueChange={(v) => onChange({ pFade: (PATTERN_FADES as readonly string[]).includes(String(v)) ? (v as PatternFade) : "none" })}
            options={PATTERN_FADES.map((f) => ({ value: f, label: FADE_LABEL[f] }))}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <label htmlFor="p-ink" className="w-20 text-xs font-bold text-gryt-muted">
          Colour
        </label>
        <input
          id="p-ink"
          type="color"
          value={style.pInk ?? effectiveInk}
          onChange={(e) => onChange({ pInk: e.target.value })}
          className="h-8 w-11 cursor-pointer rounded-(--gryt-radius-sm) border border-gryt-border bg-gryt-surface p-0.5"
        />
        {style.pInk && (
          <Button size="small" tone="neutral" onClick={() => onChange({ pInk: undefined })}>
            Use the card&rsquo;s own
          </Button>
        )}
        {pattern.kind === "scatter" && (
          <Button size="small" tone="neutral" onClick={() => onChange({ pSeed: Math.floor(Math.random() * (TUNING.pSeed.max + 1)) })}>
            Shuffle
          </Button>
        )}
        <Button
          size="small"
          tone="neutral"
          onClick={() => onChange({ pScale: 100, pRotate: 0, pOpacity: undefined, pFade: "none", pSeed: undefined, pInk: undefined })}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
