import { groupMembersByRole, type MemberGroup as CoreMemberGroup } from "@gryt/core";

import type { MemberInfo } from "./MemberSidebar";

/**
 * The member list, cut into role groups, from `@gryt/core` (GRYT-898). The
 * phone drew the same list from its own copy of the same rules, and the two had
 * drifted over what a member with no `status` means.
 *
 * Re-exported from here rather than repointed at the call site, because
 * `readableRoleColor` below is still this app's — it emits a CSS `oklch()`
 * string React Native cannot use — and MemberSidebar wants both.
 */
export { groupMembersByRole };

/** One block of the member list, holding this app's members. */
export type MemberGroup = CoreMemberGroup<MemberInfo>;

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
