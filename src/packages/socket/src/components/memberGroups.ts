import { groupMembersByRole, type MemberGroup as CoreMemberGroup } from "@gryt/core";

import type { MemberInfo } from "./MemberSidebar";

/**
 * The member list, cut into role groups, from `@gryt/core`. Re-exported here
 * because `readableRoleColor` below is still this app's (GRYT-898).
 */
export { groupMembersByRole };

/** One block of the member list, holding this app's members. */
export type MemberGroup = CoreMemberGroup<MemberInfo>;

/**
 * The role's colour, pulled into a band this theme can read. **Measured against
 * `--gryt-neutral-4`**: 4.84:1 dark, 4.72:1 light. **Chroma is capped too.**
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
