import { cardVars, normalizeCardStyle, seedFromId, usePatternAssets } from "@gryt/ui";
import { type CSSProperties, useMemo } from "react";

import { useTheme } from "@/common";
import type { ChannelPoster as Poster } from "@/settings/src/types/server";

const NO_OWL = { nickname: "" };
const NO_POSTER: Poster = { layout: "quiet" };

/** The poster's card variables. Called with null too, so a component can call it unconditionally. */
export function usePosterVars(poster: Poster | null, seed: string): CSSProperties {
  const { resolvedAppearance } = useTheme();
  const p = poster ?? NO_POSTER;
  const style = useMemo(
    () => normalizeCardStyle({ fill: p.fill, c1: p.c1, c2: p.c2, angle: p.angle, pattern: p.pattern }),
    [p.fill, p.c1, p.c2, p.angle, p.pattern],
  );
  const assets = usePatternAssets(style, NO_OWL);
  return useMemo(
    () => cardVars(style, p.c1 ?? "#7c5cff", { appearance: resolvedAppearance, seed: seedFromId(seed), ...assets }).vars as CSSProperties,
    [style, p.c1, resolvedAppearance, seed, assets],
  );
}

