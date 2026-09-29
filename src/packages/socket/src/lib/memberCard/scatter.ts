/**
 * Where a scatter pattern puts its marks: spread out so none overlap, and the same
 * every time for the same seed, so everybody sees the same card and nothing jumps.
 */

/** The area strewn, in CSS pixels. A card is 320 wide and rarely taller than this. */
export const SCATTER_AREA = { width: 360, height: 760 };

export interface ScatterMark {
  x: number;
  y: number;
  size: number;
  turn: number;
}

/** mulberry32: small, fast and the same on every engine. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 16-bit seed from a member id, so a card with no shuffle of its own still has one. */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) & 0xffff;
}

/**
 * Dart throwing: try a spot, keep it if it clears every mark so far. Cheap for the
 * few dozen marks a card holds, and it reads as scattered rather than on a grid.
 */
export function scatter(seed: number, size: number, rotate: number): ScatterMark[] {
  const next = random(seed);
  const marks: ScatterMark[] = [];
  const tries = 900;
  for (let i = 0; i < tries; i++) {
    const s = size * (0.75 + next() * 0.5);
    const x = next() * SCATTER_AREA.width;
    const y = next() * SCATTER_AREA.height;
    const turn = rotate + (next() - 0.5) * 50;
    const clear = marks.every((m) => Math.hypot(m.x - x, m.y - y) > (m.size + s) * 0.62 + size * 0.35);
    if (clear) marks.push({ x, y, size: s, turn });
  }
  return marks;
}
