/**
 * Whether the permission matrix fits, and what it falls back to.
 *
 * The role editor shows 39 permissions against every role. As a grid — roles
 * across, permissions down — that answers the question the old list could not:
 * what does Trusted have that Member does not. A grid needs horizontal room,
 * and on a phone there is none, so below a threshold the same state is drawn as
 * a ladder instead: one role per block, each showing only what it adds to the
 * rank below it.
 *
 * Pure and keyed off the container, not the window, so `check-permission-grid.mjs`
 * can assert it without a browser. The container matters rather than the window
 * because this lives inside the settings panel, which is a dialog whose width
 * has little to do with how wide the window is.
 */

/** The permission name column. Long labels — "Handle join requests" — plus the
 *  info affordance and the destructive chip. */
const PERMISSION_COLUMN = 220;

/** One role column. A name at 11px, a rank under it, and a checkbox. */
const ROLE_COLUMN = 76;

/** The table's own padding inside the surface. */
const GUTTER = 16;

/**
 * How many role columns have to be visible before a grid is worth drawing.
 *
 * Three rather than all of them. The grid scrolls sideways, so more roles than
 * this is a scroll rather than a failure — but at two columns there is nothing
 * to compare that the ladder does not say better, and the header row costs
 * vertical space the ladder spends on content.
 */
const MIN_ROLE_COLUMNS = 3;

/**
 * Room for the matrix.
 *
 * `roleCount` is in here because a server with two roles should get the ladder
 * even on a wide screen: a two-column grid is a list with extra chrome.
 */
export function hasRoomForPermissionMatrix({
  containerWidth,
  roleCount,
}: {
  containerWidth: number;
  roleCount: number;
}): boolean {
  if (roleCount < MIN_ROLE_COLUMNS) return false;
  const needed =
    PERMISSION_COLUMN + Math.min(roleCount, MIN_ROLE_COLUMNS) * ROLE_COLUMN + GUTTER;
  return containerWidth >= needed;
}

/** The width the grid asks for to show every role without scrolling. */
export function preferredMatrixWidth(roleCount: number): number {
  return PERMISSION_COLUMN + roleCount * ROLE_COLUMN + GUTTER;
}

export { MIN_ROLE_COLUMNS,PERMISSION_COLUMN, ROLE_COLUMN };
