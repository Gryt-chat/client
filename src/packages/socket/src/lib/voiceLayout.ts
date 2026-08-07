/**
 * Voice panel layout arithmetic.
 *
 * Pure functions, no React, so the rules can be checked against the numbers
 * they came from. Everything here was measured off Google Meet on 2026-08-07 —
 * the phone figures from screenshots, the desktop figures by driving a live
 * meeting and reading getBoundingClientRect. The full record is on GRYT-40.
 *
 * The uncomfortable finding is that Meet does not appear to use one rule. At
 * phone proportions the column count is the one that maximises tile area; at
 * desktop proportions that is demonstrably not it — nine people come out as
 * 4+5 when 3x3 would give larger tiles. Maximising the shared row height
 * reproduces desktop exactly and gets the phone wrong. So there are two
 * regimes here, split on container aspect, because that is what the
 * measurements support. It is fitted, not derived.
 */

/** Both measured at phone and desktop width and identical, so absolute. */
export const GRID_GAP = 12;
export const GRID_PADDING = 16;

/** Below this a tile is too small to recognise anyone in. */
export const MIN_TILE_WIDTH = 140;

/**
 * Tile aspect never leaves this range. Measured: 0.749 at three participants
 * on desktop, 1.777 at four, 1.791 at four on the phone, and free values in
 * between (1.062, 0.948, 1.534).
 */
export const MIN_TILE_ASPECT = 3 / 4;
export const MAX_TILE_ASPECT = 16 / 9;

/**
 * Where the container stops being a sidebar and starts being a stage. Gryt's
 * sidebar sits near 0.6 and the maximised state near 1.6, so the exact
 * threshold is not load-bearing — nothing real lands near 1.0.
 */
export const WIDE_LAYOUT_MIN_ASPECT = 1;

/**
 * A pinned share puts participants in a strip across the top, and the strip is
 * 25% of the container height: measured 188 of 755 and 198 of 789. One of the
 * few things Meet sizes proportionally rather than absolutely.
 */
export const SHARE_STRIP_HEIGHT_FRACTION = 0.25;

/** Meet showed six slots and collapsed the rest into "+N others". */
export const SHARE_STRIP_MAX_SLOTS = 6;

/**
 * The picture-in-picture tile is an absolute size, not a fraction: 235x132 in
 * a 1207-wide container and 227x131 in a 395-wide one. Nearly the same pixels
 * at three times the container width.
 */
export const PIP_WIDTH = 235;
export const PIP_HEIGHT = 132;
export const PIP_INSET = 16;
export const PIP_RADIUS = 12;

/** Below this height the grid stops adding tiles and collects the rest. */
export const MIN_READABLE_TILE_HEIGHT = 110;

/**
 * Corner radius steps with the tile. Measured at four sizes — a 132px-tall
 * tile is 12, 296 is 16, and both 526 and 777 are 24 — so the thresholds
 * between them are interpolated rather than observed.
 */
export function tileRadius(height: number): number {
  if (height >= 400) return 24;
  if (height >= 150) return 16;
  return 12;
}

/**
 * How many tiles sit in each row. Remainder lands in the later rows, so the
 * short row is always at the top: three render as one above two, five as two
 * above three, nine as four above five.
 */
export function distributeRows(count: number, columns: number): number[] {
  if (count <= 0 || columns <= 0) return [];

  const rows = Math.ceil(count / columns);
  const base = Math.floor(count / rows);
  const withExtra = count % rows;

  return Array.from({ length: rows }, (_, i) =>
    i >= rows - withExtra ? base + 1 : base,
  );
}

/** The cell's shape clamped into the allowed range, then fitted inside it. */
export function fitTile(
  cellWidth: number,
  cellHeight: number,
): { width: number; height: number } {
  if (cellWidth <= 0 || cellHeight <= 0) return { width: 0, height: 0 };

  const aspect = Math.min(
    MAX_TILE_ASPECT,
    Math.max(MIN_TILE_ASPECT, cellWidth / cellHeight),
  );
  const height = Math.min(cellHeight, cellWidth / aspect);

  return { width: height * aspect, height };
}

export interface GridRow {
  /** How many tiles this row holds. */
  count: number;
  width: number;
  height: number;
}

export interface GridLayout {
  rows: GridRow[];
  /** Largest tile height in the layout, for readability decisions. */
  tileHeight: number;
}

function rowCellWidth(width: number, count: number): number {
  return (width - (count - 1) * GRID_GAP) / count;
}

/**
 * Sidebar proportions: pick the column count giving the largest capped tile,
 * then clamp each row independently.
 *
 * Matches the phone measurements exactly — four people in a 395x785 container
 * come out as four stacked 333x187 tiles, centred, which is what Meet does.
 */
function narrowLayout(
  width: number,
  height: number,
  count: number,
): GridLayout {
  let best: GridLayout | null = null;
  let bestArea = 0;

  for (let cols = 1; cols <= count; cols++) {
    const perRow = distributeRows(count, cols);
    const cellH = (height - (perRow.length - 1) * GRID_GAP) / perRow.length;
    if (cellH <= 0) continue;
    if (rowCellWidth(width, cols) < MIN_TILE_WIDTH) break;

    const rows = perRow.map((n) => {
      const tile = fitTile(rowCellWidth(width, n), cellH);
      return { count: n, width: tile.width, height: tile.height };
    });

    const area = rows.reduce((sum, r) => sum + r.count * r.width * r.height, 0);

    if (area > bestArea) {
      bestArea = area;
      best = { rows, tileHeight: Math.max(...rows.map((r) => r.height)) };
    }
  }

  return best ?? { rows: [{ count, width: 0, height: 0 }], tileHeight: 0 };
}

/**
 * Stage proportions: every row shares one height, and the winning column count
 * is the one that makes that height largest.
 *
 * The shared height is what a single row can be without any row exceeding the
 * 3:4 portrait floor. Nine people at 1208x755 land on 4+5 because the 5-tile
 * row's 232px cells cap the height at 309, which is still taller than the 244
 * a 3x3 would give — and 3x3 has the larger tiles by area, which is precisely
 * why area is the wrong objective here.
 */
function wideLayout(width: number, height: number, count: number): GridLayout {
  // Four is measured as an exact 16:9 2x2, which neither objective produces:
  // the cell has spare height and Meet declines to use it. Reproduced over
  // three stable reads, so it is copied rather than explained.
  if (count === 4) {
    const cellW = rowCellWidth(width, 2);
    const tileH = Math.min((height - GRID_GAP) / 2, cellW / MAX_TILE_ASPECT);
    const row = {
      count: 2,
      width: Math.min(cellW, tileH * MAX_TILE_ASPECT),
      height: tileH,
    };
    return { rows: [row, { ...row }], tileHeight: tileH };
  }

  let best: GridLayout | null = null;
  let bestHeight = 0;

  for (let cols = 1; cols <= count; cols++) {
    const perRow = distributeRows(count, cols);
    if (rowCellWidth(width, Math.max(...perRow)) < MIN_TILE_WIDTH) break;

    const availableH =
      (height - (perRow.length - 1) * GRID_GAP) / perRow.length;
    if (availableH <= 0) continue;

    // The narrowest row is the one that runs out of height first.
    const portraitCap = Math.min(
      ...perRow.map((n) => rowCellWidth(width, n) / MIN_TILE_ASPECT),
    );
    const tileH = Math.min(availableH, portraitCap);

    if (tileH > bestHeight) {
      bestHeight = tileH;
      best = {
        rows: perRow.map((n) => ({
          count: n,
          // Rows fill the width unless that would push past 16:9.
          width: Math.min(rowCellWidth(width, n), tileH * MAX_TILE_ASPECT),
          height: tileH,
        })),
        tileHeight: tileH,
      };
    }
  }

  return best ?? { rows: [{ count, width: 0, height: 0 }], tileHeight: 0 };
}

/** The participant grid for a container of this size. */
export function computeGridLayout(
  width: number,
  height: number,
  count: number,
): GridLayout {
  if (count <= 0 || width <= 0 || height <= 0) {
    return { rows: [], tileHeight: 0 };
  }

  return width / height >= WIDE_LAYOUT_MIN_ASPECT
    ? wideLayout(width, height, count)
    : narrowLayout(width, height, count);
}

/**
 * How many tiles fit before they stop being readable.
 *
 * Walks the counts rather than solving, because the column count changes
 * underneath as the count grows and tile size is not monotonic across those
 * jumps.
 */
export function gridCapacity(
  width: number,
  height: number,
  count: number,
): number {
  if (width <= 0 || height <= 0) return count;

  let capacity = 1;

  for (let k = 1; k <= Math.min(count, 49); k++) {
    const { tileHeight } = computeGridLayout(width, height, k);
    if (tileHeight >= MIN_READABLE_TILE_HEIGHT) capacity = k;
  }

  return capacity;
}

/**
 * The pinned-share split. Which side the share goes on flips with the
 * container: at sidebar proportions the share is pinned above the grid, at
 * stage proportions the participants become a strip across the top and the
 * share takes everything below.
 */
export interface ShareLayout {
  orientation: "share-above" | "strip-above";
  /** Box for the share itself, already fitted to its own aspect. */
  share: { width: number; height: number };
  /** What is left for the participants. */
  participants: { width: number; height: number };
}

export function computeShareLayout(
  width: number,
  height: number,
  shareAspect: number,
): ShareLayout {
  const aspect = shareAspect > 0 ? shareAspect : 16 / 9;

  if (width / height >= WIDE_LAYOUT_MIN_ASPECT) {
    const stripHeight = Math.round(height * SHARE_STRIP_HEIGHT_FRACTION);
    const shareHeight = Math.max(0, height - stripHeight - GRID_GAP);
    // Fitted to its own shape inside what is left, centred by the renderer.
    const shareWidth = Math.min(width, shareHeight * aspect);

    return {
      orientation: "strip-above",
      share: {
        width: shareWidth,
        height: Math.min(shareHeight, shareWidth / aspect),
      },
      participants: { width, height: stripHeight },
    };
  }

  // Sidebar: the share keeps its shape at full width, capped so it cannot take
  // the whole panel, and the grid gets the rest.
  const shareHeight = Math.min(width / aspect, height * 0.6);

  return {
    orientation: "share-above",
    share: {
      width: Math.min(width, shareHeight * aspect),
      height: shareHeight,
    },
    participants: {
      width,
      height: Math.max(0, height - shareHeight - GRID_GAP),
    },
  };
}
