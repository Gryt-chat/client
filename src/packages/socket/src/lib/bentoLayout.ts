/**
 * The bento rule for voice tiles: they fill the whole area. Screen shares get the
 * most room, then cameras, then people without one, who stretch to fill the gaps.
 */

export type BentoKind = "share" | "cam" | "avatar";

export interface BentoItem {
  id: string;
  kind: BentoKind;
  /** Width over height of the picture; a phone's front camera is 9:16. */
  ratio?: number;
}

export interface BentoRect {
  id: string;
  kind: BentoKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

const TARGET: Record<BentoKind, number> = { share: 16 / 9, cam: 16 / 9, avatar: 1 };
const WEIGHT: Record<BentoKind, number> = { share: 6, cam: 3, avatar: 1 };
const MIN_SIDE = 72;

const shapeOf = (item: BentoItem) => item.ratio || TARGET[item.kind];
const offBy = (a: number, b: number) => Math.abs(Math.log(a / b));

function shapeCost(item: BentoItem, ratio: number): number {
  const d = offBy(ratio, shapeOf(item));
  // A camera crops to about 4:3 at most; a share is shown whole, so off-shape only costs bars.
  if (item.kind === "cam") return 3 * d + (d > Math.log(1.35) ? 400 : 0);
  if (item.kind === "share") return 6 * d + (d > Math.log(1.6) ? 300 : 0);
  return ratio < 0.6 || ratio > 2 ? 60 + 20 * d : 0.2 * d;
}

/** Equal lines across a box, each filled edge to edge, in whichever line count fits best. */
function fillLines(
  items: BentoItem[],
  box: { x: number; y: number; width: number; height: number },
  gap: number,
  out: BentoRect[],
  horizontal = true,
  even = false,
): number {
  // In the even grid people take the cameras' shape, so every cell matches.
  const lead = items.find((i) => i.kind !== "avatar");
  const evenShape = lead ? shapeOf(lead) : 16 / 9;
  const want = (it: BentoItem) => {
    if (it.kind !== "avatar") return shapeOf(it);
    return even ? evenShape : 1;
  };
  const along = horizontal ? box.width : box.height;
  const across = horizontal ? box.height : box.width;

  let best: { cost: number; per: number; lines: number; thick: number } | null = null;
  for (let tries = 1; tries <= items.length; tries++) {
    const per = Math.ceil(items.length / tries);
    const lines = Math.ceil(items.length / per);
    const thick = (across - (lines - 1) * gap) / lines;
    let cost = 0;
    for (let l = 0; l < lines; l++) {
      const row = items.slice(l * per, (l + 1) * per);
      const sum = row.reduce((a, it) => a + want(it), 0);
      const room = along - (row.length - 1) * gap;
      for (const it of row) {
        const len = (room * want(it)) / sum;
        cost += shapeCost(it, horizontal ? len / thick : thick / len);
      }
    }
    if (!best || cost < best.cost) best = { cost, per, lines, thick };
  }
  if (!best) return 0;

  for (let l = 0; l < best.lines; l++) {
    const row = items.slice(l * best.per, (l + 1) * best.per);
    const sum = row.reduce((a, it) => a + want(it), 0);
    const room = along - (row.length - 1) * gap;
    let pos = 0;
    for (const it of row) {
      const len = (room * want(it)) / sum;
      const offset = l * (best.thick + gap);
      out.push(
        horizontal
          ? { id: it.id, kind: it.kind, x: box.x + pos, y: box.y + offset, width: len, height: best.thick }
          : { id: it.id, kind: it.kind, x: box.x + offset, y: box.y + pos, width: best.thick, height: len },
      );
      pos += len + gap;
    }
  }
  return best.cost;
}

export function computeBentoLayout(
  items: BentoItem[],
  width: number,
  height: number,
  gap: number,
): BentoRect[] {
  if (!items.length || width <= 0 || height <= 0) return [];

  const top = (["share", "cam"] as const).find((k) => items.some((i) => i.kind === k)) ?? "avatar";
  const main = items.filter((i) => i.kind === top);
  const rest = items.filter((i) => i.kind !== top).sort((a, b) => WEIGHT[b.kind] - WEIGHT[a.kind]);
  const whole = { x: 0, y: 0, width, height };
  const candidates: Array<{ cost: number; rects: BentoRect[] }> = [];

  const tryLayout = (build: (out: BentoRect[]) => number, extra = 0) => {
    const rects: BentoRect[] = [];
    candidates.push({ cost: build(rects) + extra, rects });
  };

  if (top !== "share") tryLayout((out) => fillLines([...main, ...rest], whole, gap, out, true, true));
  if (!rest.length) {
    tryLayout((out) => fillLines(main, whole, gap, out));
  } else {
    const wMain = main.reduce((a, i) => a + WEIGHT[i.kind], 0);
    const wRest = rest.reduce((a, i) => a + WEIGHT[i.kind], 0);
    const weighted = Math.min(0.85, Math.max(0.55, wMain / (wMain + wRest)));
    for (let f = 0.25; f <= 0.92; f += 0.01) {
      const mh = Math.round((height - gap) * f);
      const mw = Math.round((width - gap) * f);
      const drift = 4 * Math.abs(f - weighted);
      tryLayout(
        (out) =>
          fillLines(main, { x: 0, y: 0, width, height: mh }, gap, out) +
          fillLines(rest, { x: 0, y: mh + gap, width, height: height - mh - gap }, gap, out),
        drift,
      );
      tryLayout(
        (out) =>
          fillLines(main, { x: 0, y: 0, width: mw, height }, gap, out) +
          fillLines(rest, { x: mw + gap, y: 0, width: width - mw - gap, height }, gap, out, false),
        drift,
      );
    }
  }

  for (const c of candidates) {
    const areas = (k: BentoKind) => c.rects.filter((r) => r.kind === k).map((r) => r.width * r.height);
    const max = (k: BentoKind) => Math.max(0, ...areas(k));
    // A share is clearly the biggest thing; a camera is never smaller than a person without one.
    if (areas("share").length && Math.min(...areas("share")) < 1.5 * Math.max(max("cam"), max("avatar"))) c.cost += 1000;
    if (areas("cam").length && Math.min(...areas("cam")) < 0.9 * max("avatar")) c.cost += 1000;
    if (c.rects.some((r) => Math.min(r.width, r.height) < MIN_SIDE)) c.cost += 200;
  }

  return candidates.reduce((a, b) => (b.cost < a.cost ? b : a)).rects;
}
