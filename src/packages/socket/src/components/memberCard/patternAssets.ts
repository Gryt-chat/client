import { avatarSeed, decodeWorn, owlAvatarSvg, wornToOptions } from "@gryt/owl";
import { useEffect, useState } from "react";

import type { CardStyle } from "../../lib/memberCard/cardStyle";
import { GRYT_MARK } from "../../lib/memberCard/grytMark";
import { cardPattern } from "../../lib/memberCard/patterns";
import type { Tile } from "../../lib/memberCard/patterns/tileTypes";
import type { PatternMark } from "../../lib/memberCard/patternSvg";

/** The icon a card with the icon pattern and no pick of its own strews. */
export const DEFAULT_ICON = "star";

let tiles: Promise<Map<string, Tile>> | null = null;

/** All the tile paths, in one chunk that only loads once somebody's card needs it. */
function loadTiles(): Promise<Map<string, Tile>> {
  tiles ??= import("../../lib/memberCard/patterns/tiles.generated").then((m) => new Map(m.TILES.map((t) => [t.id, t])));
  return tiles;
}

const CIRCLE = "<circle cx='512' cy='512' r='512'/>";

/** The member's own owl head, cut to a circle like the Gryt mark. */
function owlMark(nickname: string, worn?: string | null): PatternMark | null {
  const seed = avatarSeed(nickname);
  if (!seed) return null;
  const look = decodeWorn(worn);
  const svg = owlAvatarSvg(seed, { ...(look ? wornToOptions(look) : {}), background: false });
  const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return { viewBox: "0 0 1024 1024", body, clip: CIRCLE, mono: false };
}

export interface PatternAssets {
  tile?: Tile;
  mark?: PatternMark;
}

/** Whatever this card's pattern draws with, loaded on demand. Empty until it arrives. */
export function usePatternAssets(style: CardStyle, owl: { nickname: string; worn?: string | null }): PatternAssets {
  const pattern = cardPattern(style.pattern);
  const [assets, setAssets] = useState<PatternAssets>({});
  const icon = style.pIcon ?? DEFAULT_ICON;

  useEffect(() => {
    let live = true;
    const set = (next: PatternAssets) => live && setAssets(next);
    if (pattern.kind === "tile") void loadTiles().then((all) => set({ tile: all.get(pattern.id) }));
    else if (pattern.id === "gryt-faces") set({ mark: { ...GRYT_MARK, mono: false } });
    else if (pattern.id === "my-owl") set({ mark: owlMark(owl.nickname, owl.worn) ?? undefined });
    else if (pattern.id === "icon") {
      void import("./phosphorIcons")
        .then((m) => m.loadIconMark(icon).then((mark) => mark ?? m.loadIconMark(DEFAULT_ICON)))
        .then((mark) => set({ mark: mark ?? undefined }));
    } else set({});
    return () => {
      live = false;
    };
  }, [pattern.id, pattern.kind, icon, owl.nickname, owl.worn]);

  return assets;
}
