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
 * The member list, cut into role groups with everybody offline at the bottom.
 *
 * Three rules, and the third is the one worth stating: **offline leaves its
 * role.** Somebody who is not here is not usefully filed under Moderator — the
 * question the list answers while they are away is "who is around", and a
 * moderator who is asleep is not an answer to it. So they go to one group at
 * the end, in one alphabet, rather than to the bottom of each role.
 *
 * Roles run highest rank first, which is the same order the role editor draws
 * them in and the same order rank means everywhere else. Roles nobody holds
 * are left out rather than drawn empty, so a server with fifteen roles and
 * four people online shows four headings.
 *
 * A member whose role the server did not describe — an older server that sends
 * no role list, or a role deleted while this list was open — lands in one
 * unnamed group after the named ones. That is also what the whole list looks
 * like on a server too old to send roles at all, which is the graceful version
 * of this feature rather than an empty screen.
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
 * The role's colour, pulled into a band this theme can actually read.
 *
 * Role colours are chosen by whoever runs the server, against no background in
 * particular, and half of them will be unreadable somewhere: `#000080` on the
 * dark sidebar, `#ffff00` on the light one. Refusing to draw those would throw
 * away the operator's choice; drawing them as-is throws away the name.
 *
 * So the hue is kept and the other two are clamped, in OKLCH, where lightness
 * is perceptual rather than a channel average. Navy stays navy and becomes
 * legible, instead of turning grey or turning into a different colour.
 *
 * The numbers are measured against the row's own background rather than
 * chosen. On `--gryt-neutral-4` — `rgb(34,38,47)` dark, `rgb(237,239,244)`
 * light — the worst case over every hue at the chroma ceiling is 4.84:1 dark
 * and 4.72:1 light, so any colour an operator picks clears WCAG AA for body
 * text. Lightness alone was not enough: at full chroma a floor of 0.62 left
 * a saturated red at 3.58:1, which is why chroma is capped too.
 *
 * A browser without relative colour syntax drops the declaration and the name
 * inherits the ordinary text colour — which is exactly the right fallback, so
 * there is no `@supports` here.
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
