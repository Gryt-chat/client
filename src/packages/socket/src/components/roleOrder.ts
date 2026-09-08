/**
 * What the ranks become when a role is dropped somewhere else. Rank still
 * decides; the number on screen is derived from where things ended up.
 */

export interface RankedRole {
  id: string;
  rank: number;
}

/** The one role that never moves: the server refuses to save it. */
export const OWNER_ROLE = "owner";

/**
 * The top of the range the other roles are spread across. Below the owner's 100,
 * so a role can never be arranged into a tie with it.
 */
const TOP = 90;

/**
 * Highest first, the order the list is drawn in. Ties broken by id, or two roles
 * seeded at the same rank swap places between renders.
 */
export function byRank(roles: RankedRole[]): RankedRole[] {
  return [...roles].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

/**
 * Move one role above or below another, and say which ranks changed. Spaced
 * rather than 1, 2, 3: room between neighbours means fewer rewrites.
 */
export function ranksAfterMove(
  roles: RankedRole[],
  activeId: string,
  overId: string,
): RankedRole[] {
  if (activeId === overId) return [];

  const movable = byRank(roles).filter((r) => r.id !== OWNER_ROLE);
  const from = movable.findIndex((r) => r.id === activeId);
  const to = movable.findIndex((r) => r.id === overId);
  if (from < 0 || to < 0) return [];

  const next = [...movable];
  next.splice(to, 0, ...next.splice(from, 1));

  // Never below 1, which a list longer than the spacing would otherwise reach,
  // and never a tie with the owner.
  const step = Math.max(1, Math.floor(TOP / (next.length + 1)));

  const changed: RankedRole[] = [];
  next.forEach((role, index) => {
    const rank = Math.max(1, TOP - index * step);
    if (rank !== role.rank) changed.push({ ...role, rank });
  });

  return changed;
}
