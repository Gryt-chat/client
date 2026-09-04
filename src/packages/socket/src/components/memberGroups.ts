import type { ServerRoleSummary } from "../hooks/usePermissions";
import type { MemberInfo } from "./MemberSidebar";

/**
 * One block of the member list: a heading and the people under it.
 *
 * `color` is the role's own colour, straight from the server, or null for a
 * role that has none and for the two groups that are not roles.
 */
export interface MemberGroup {
  key: string;
  title: string;
  color: string | null;
  members: MemberInfo[];
}

/** Anybody not offline, in one group, when the server named no roles. */
const UNGROUPED_KEY = "__ungrouped__";

const OFFLINE_KEY = "__offline__";

function byName(a: MemberInfo, b: MemberInfo): number {
  return a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base" });
}

/**
 * The member list, cut into role groups. **Offline leaves its role** — the
 * question the list answers is "who is around", so they go to one group at the
 * end in one alphabet rather than to the bottom of each role.
 *
 * Roles run highest rank first, and roles nobody holds are left out rather than
 * drawn empty. A member whose role the server did not describe lands in one
 * unnamed group after the named ones, which is also what a server too old to
 * send roles looks like.
 */
export function groupMembersByRole(
  members: MemberInfo[],
  roles: ServerRoleSummary[],
): MemberGroup[] {
  const byRank = [...roles].sort((a, b) => b.rank - a.rank);
  const known = new Map(roles.map((r) => [r.id, r]));

  const offline: MemberInfo[] = [];
  const present = new Map<string, MemberInfo[]>();

  for (const member of members) {
    if (member.status === "offline") {
      offline.push(member);
      continue;
    }

    const key = member.role && known.has(member.role) ? member.role : UNGROUPED_KEY;
    const bucket = present.get(key);
    if (bucket) bucket.push(member);
    else present.set(key, [member]);
  }

  const groups: MemberGroup[] = [];

  for (const role of byRank) {
    const held = present.get(role.id);
    if (!held?.length) continue;
    groups.push({
      key: role.id,
      title: role.name,
      color: role.color,
      members: held.sort(byName),
    });
  }

  const rest = present.get(UNGROUPED_KEY);
  if (rest?.length) {
    groups.push({
      key: UNGROUPED_KEY,
      // Named rather than blank, because a heading with no words above a list
      // of people reads as a rendering fault.
      title: groups.length > 0 ? "Everyone else" : "Members",
      color: null,
      members: rest.sort(byName),
    });
  }

  if (offline.length) {
    groups.push({
      key: OFFLINE_KEY,
      title: "Offline",
      color: null,
      members: offline.sort(byName),
    });
  }

  return groups;
}

/**
 * The role's colour, pulled into a band this theme can read. An operator picks
 * against no background in particular, and `#000080` on the dark sidebar is
 * unreadable — refusing to draw it throws away their choice, drawing it as-is
 * throws away the name.
 *
 * Hue is kept and the other two clamped, in OKLCH, so navy stays navy.
 *
 * **The numbers are measured against `--gryt-neutral-4`**, not chosen: worst
 * case over every hue is 4.84:1 dark and 4.72:1 light, so anything clears WCAG
 * AA. **Chroma is capped too** — a lightness floor alone left a saturated red
 * at 3.58:1.
 *
 * A browser without relative colour syntax drops the declaration and the name
 * inherits ordinary text colour, so there is no `@supports` here.
 */
const READABLE_BAND = {
  dark: "clamp(0.68, l, 0.95)",
  light: "clamp(0, l, 0.48)",
} as const;

/** Above this, a hue's own darkness beats any lightness the clamp can give it. */
const MAX_CHROMA = 0.16;

export function readableRoleColor(
  color: string | null | undefined,
  appearance: "dark" | "light",
): string | undefined {
  if (!color) return undefined;
  return `oklch(from ${color} ${READABLE_BAND[appearance]} min(c, ${MAX_CHROMA}) h)`;
}
