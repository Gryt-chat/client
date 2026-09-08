/**
 * The few things every surface showing a member has to answer the same way. Each
 * had two or three copies before, which is how the hover card and the list drift.
 */

import type { ServerRoleSummary } from "../hooks/usePermissions";

/**
 * The ranks the built-in roles ship with, for a server that has not told us
 * otherwise — one predating editable roles, or a menu with no known host.
 */
export const BUILT_IN_RANK: Record<string, number> = {
  owner: 100,
  admin: 80,
  mod: 60,
  member: 40,
  guest: 10,
};

/**
 * Who may act on whom. Rank decides that; permissions decide what the action is.
 * They used to be one question asked of a four-rung ladder.
 */
export function makeRankOf(roles: ServerRoleSummary[]) {
  return (roleId?: string): number =>
    (roleId ? roles.find((r) => r.id === roleId)?.rank ?? BUILT_IN_RANK[roleId] : undefined) ?? -1;
}

export function outranks(
  roles: ServerRoleSummary[],
  mine: string | undefined,
  theirs: string | undefined,
): boolean {
  if (!mine || !theirs) return false;
  const rankOf = makeRankOf(roles);
  return rankOf(mine) > rankOf(theirs);
}

/** What is behind a member: an account, a key on one device, or a program. */
export type IdentityTier = "account" | "local" | "bot";

/**
 * Amber marks "no account" and nothing else, so it stays worth noticing. An
 * account and a bot are both ordinary.
 */
export const TIER_LABEL: Record<string, { label: string; amber: boolean }> = {
  account: { label: "Gryt account", amber: false },
  local: { label: "No account", amber: true },
  bot: { label: "Bot", amber: false },
};

/**
 * When somebody joined, or null when the server did not say. `createdAt` on a
 * member is the join date: the row survives them leaving.
 */
export function formatJoined(value?: string | Date): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Ban lengths, as minutes. Null is permanent, which is what the server stores
 * as a null expiry -- so the two agree without the client knowing the encoding.
 */
export const BAN_DURATIONS: { value: string; label: string; minutes: number | null }[] = [
  { value: "1h", label: "1 hour", minutes: 60 },
  { value: "1d", label: "1 day", minutes: 1440 },
  { value: "7d", label: "7 days", minutes: 10080 },
  { value: "30d", label: "30 days", minutes: 43200 },
  { value: "permanent", label: "Permanent", minutes: null },
];
