/**
 * The bento rule for voice tiles: no empty space, shares biggest, cameras keep their
 * shape, people without a camera fill. The cases are the ones on the design canvas.
 */

import assert from "node:assert/strict";

import { type BentoItem, type BentoKind, computeBentoLayout } from "../src/packages/socket/src/lib/bentoLayout.ts";

const GAP = 12;
const SIZES: Array<[string, number, number]> = [
  ["preset 1", 320, 618],
  ["preset 2", 616, 618],
  ["preset 3", 1032, 618],
  ["fullscreen", 1408, 768],
];
const KINDS: Record<string, BentoKind> = { s: "share", c: "cam", a: "avatar", p: "cam" };

/** "sca" is a share, a camera and a person; "p" is a phone camera at 9:16. */
function call(code: string): BentoItem[] {
  return [...code].map((c, i) => ({ id: `${c}${i}`, kind: KINDS[c], ratio: c === "p" ? 9 / 16 : undefined }));
}

const area = (r: { width: number; height: number }) => r.width * r.height;

for (const code of ["aaaa", "ccaa", "saaa", "scaaa", "sscccaaa", "ccccaaaaaaaa", "pcaa", "c", "s"]) {
  for (const [name, W, H] of SIZES) {
    const where = `${code} at ${name}`;
    const items = call(code);
    const rects = computeBentoLayout(items, W, H, GAP);

    assert.deepEqual(rects.map((r) => r.id).sort(), items.map((i) => i.id).sort(), `${where}: every tile placed once`);

    for (const r of rects) {
      assert.ok(r.x >= -0.5 && r.y >= -0.5 && r.x + r.width <= W + 0.5 && r.y + r.height <= H + 0.5, `${where}: ${r.id} inside`);
    }
    for (const a of rects) {
      for (const b of rects) {
        if (a === b) continue;
        const apart = a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;
        assert.ok(apart, `${where}: ${a.id} and ${b.id} overlap`);
      }
    }

    const ratios = rects.map((r) => r.width / r.height);
    assert.ok(ratios.every((q) => q <= 16 / 9 + 1e-6 && q >= 9 / 16 - 1e-6), `${where}: no tile past 16:9 or 9:16`);
    // No empty space unless a tile hit that limit: the tiles reach every edge, and only the gaps are left over.
    if (ratios.some((q) => Math.abs(q - 16 / 9) < 1e-6 || Math.abs(q - 9 / 16) < 1e-6)) continue;
    assert.ok(Math.abs(Math.min(...rects.map((r) => r.x))) < 0.5, `${where}: reaches the left edge`);
    assert.ok(Math.abs(Math.max(...rects.map((r) => r.x + r.width)) - W) < 0.5, `${where}: reaches the right edge`);
    assert.ok(Math.abs(Math.min(...rects.map((r) => r.y))) < 0.5, `${where}: reaches the top`);
    assert.ok(Math.abs(Math.max(...rects.map((r) => r.y + r.height)) - H) < 0.5, `${where}: reaches the bottom`);
    const filled = rects.reduce((sum, r) => sum + area(r), 0) / (W * H);
    assert.ok(filled > 0.8, `${where}: tiles cover ${filled.toFixed(2)} of the area`);

    const of = (k: BentoKind) => rects.filter((r) => r.kind === k).map(area);
    if (of("share").length && rects.length > of("share").length) {
      const others = Math.max(0, ...of("cam"), ...of("avatar"));
      assert.ok(Math.min(...of("share")) >= 1.5 * others - 1, `${where}: a share is clearly the biggest tile`);
    }
    if (of("cam").length && of("avatar").length) {
      assert.ok(Math.min(...of("cam")) >= 0.9 * Math.max(...of("avatar")) - 1, `${where}: a camera is never smaller than a person`);
    }
  }
}

// Cameras keep their shape where there is room to: never cropped past about 4:3.
for (const [code, W, H] of [["ccaa", 1032, 618], ["ccaa", 1408, 768], ["c", 1032, 618], ["pcaa", 1032, 618], ["pcaa", 1408, 768]] as const) {
  const items = call(code);
  for (const r of computeBentoLayout(items, W, H, GAP).filter((r) => r.kind === "cam")) {
    const want = items.find((i) => i.id === r.id)?.ratio ?? 16 / 9;
    const off = Math.abs(Math.log(r.width / r.height / want));
    assert.ok(off <= Math.log(1.35) + 1e-6, `${code} at ${W}x${H}: ${r.id} is ${(r.width / r.height).toFixed(2)}, wants ${want.toFixed(2)}`);
  }
}

// A phone's front camera stays portrait.
const phone = computeBentoLayout(call("pcaa"), 1032, 618, GAP).find((r) => r.id === "p0");
assert.ok(phone && phone.height > phone.width, "a 9:16 camera is drawn portrait");

// Two cameras and two people with room to spare: an even 2x2, as Sivert asked.
const even = computeBentoLayout(call("ccaa"), 1408, 768, GAP);
assert.equal(new Set(even.map((r) => Math.round(r.width))).size, 1, "two cameras and two people at fullscreen share one tile size");

// One person in a tall preset 1 is a 9:16 tile in the middle, not a strip (Sivert's screenshot, 2026-10-27).
const [lone] = computeBentoLayout(call("a"), 370, 1240, GAP);
assert.ok(Math.abs(lone.width / lone.height - 9 / 16) < 1e-6, "a lone person stops at 9:16");
assert.ok(Math.abs(lone.y + lone.height / 2 - 620) < 0.5, "and sits in the middle");

assert.deepEqual(computeBentoLayout([], 800, 600, GAP), []);
assert.deepEqual(computeBentoLayout(call("aa"), 0, 600, GAP), []);

console.log("bento layout: ok");
