/**
 * What the ranks become when a role is dropped somewhere else.
 *
 * Rank has not gone anywhere — the server still compares it for kicks, bans,
 * role changes and the joining defaults. What has gone is the *number* on the
 * screen: an operator arranges a list, and the numbers are derived from where
 * things ended up.
 *
 * Pure and in its own file so the arithmetic can be read and checked without a
 * drag, a socket or a server.
 */

export interface RankedRole {
  id: string;
  rank: number;
}

/** The one role that never moves: the server refuses to save it. */
export const OWNER_ROLE = "owner";

/**
 * The top of the range the other roles are spread across.
 *
 * Below the owner's 100 with room to spare, so a role can never be arranged
 * into a tie with it — a tie would make `rank >= auth.rank` true for the owner
 * against somebody the list shows as below them.
 */
const TOP = 90;

/**
 * Highest first, which is the order the list is drawn in.
 *
 * Ties broken by id rather than left to the sort's discretion, because two
 * roles seeded at the same rank — `trusted` and `greeter` both arrive at 5 —
 * would otherwise swap places between renders and look like rearranging.
 */
export function byRank(roles: RankedRole[]): RankedRole[] {
  return [...roles].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

/**
 * Move one role above or below another, and say which ranks changed.
 *
 * Returns only the roles that actually moved, so a drop that changes three
 * positions is three saves rather than a rewrite of every role on the server.
 *
 * Spaced rather than numbered 1, 2, 3: room between neighbours means a role
 * added later, or one moved by somebody else while this screen was open, does
 * not need every other row rewritten to fit between two of them.
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
