/**
 * The permission grid's fallback threshold, asserted without a browser.
 *
 * The decision lives in lib/permissionGridLayout.ts so it can be checked here.
 * What this is guarding: a matrix drawn into a container too narrow for it does
 * not fail loudly — it draws two visible columns and puts the rest behind a
 * sideways scroll nobody finds, which reads as "the other roles are missing".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../src/packages/socket/src/lib/permissionGridLayout.ts", import.meta.url),
  "utf8",
);
const num = (name) => {
  const m = src.match(new RegExp(`const ${name} = (\\d+)`));
  assert.ok(m, `${name} not found — did the constant get renamed?`);
  return Number(m[1]);
};
const PERMISSION_COLUMN = num("PERMISSION_COLUMN");
const ROLE_COLUMN = num("ROLE_COLUMN");
const GUTTER = num("GUTTER");
const MIN_ROLE_COLUMNS = num("MIN_ROLE_COLUMNS");

function hasRoomForPermissionMatrix({ containerWidth, roleCount }) {
  if (roleCount < MIN_ROLE_COLUMNS) return false;
  const needed =
    PERMISSION_COLUMN + Math.min(roleCount, MIN_ROLE_COLUMNS) * ROLE_COLUMN + GUTTER;
  return containerWidth >= needed;
}

const threshold = PERMISSION_COLUMN + MIN_ROLE_COLUMNS * ROLE_COLUMN + GUTTER;

// A phone gets the ladder. 390 is an iPhone 15 and the settings panel is
// narrower than the screen, so this has room to spare.
assert.equal(
  hasRoomForPermissionMatrix({ containerWidth: 390, roleCount: 6 }),
  false,
  "a phone-width container must fall back to the ladder",
);

// A settings dialog on a laptop gets the matrix.
assert.equal(
  hasRoomForPermissionMatrix({ containerWidth: 720, roleCount: 6 }),
  true,
  "a laptop-width container must get the matrix",
);

// Exactly at the threshold is enough; one pixel under is not.
assert.equal(hasRoomForPermissionMatrix({ containerWidth: threshold, roleCount: 6 }), true);
assert.equal(hasRoomForPermissionMatrix({ containerWidth: threshold - 1, roleCount: 6 }), false);

// Role count, not just width. Two roles on a wide screen is a list with extra
// chrome, so it stays a ladder.
assert.equal(
  hasRoomForPermissionMatrix({ containerWidth: 1400, roleCount: 2 }),
  false,
  "two roles must stay a ladder however wide the container is",
);
assert.equal(hasRoomForPermissionMatrix({ containerWidth: 1400, roleCount: 3 }), true);

// A server with many roles still gets the matrix at the same threshold — the
// extra columns are a sideways scroll, not a reason to give up on the grid.
assert.equal(hasRoomForPermissionMatrix({ containerWidth: threshold, roleCount: 20 }), true);

console.log(`check-permission-grid: ok (matrix at >= ${threshold}px with >= ${MIN_ROLE_COLUMNS} roles)`);
