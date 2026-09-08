/**
 * Whether the permission matrix fits, and what it falls back to. Pure and keyed
 * off the container, not the window, because this lives inside a dialog.
 */

/** The permission name column. Long labels — "Handle join requests" — plus the
 *  info affordance and the destructive chip. */
const PERMISSION_COLUMN = 220;

/** One role column. A name at 11px, a rank under it, and a checkbox. */
const ROLE_COLUMN = 76;

/** The table's own padding inside the surface. */
const GUTTER = 16;

/**
 * How many role columns have to be visible before a grid is worth drawing. At two
 * there is nothing to compare that the ladder does not say better.
 */
const MIN_ROLE_COLUMNS = 3;

/**
 * Room for the matrix. `roleCount` is here because a two-column grid is a list
 * with extra chrome, even on a wide screen.
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
