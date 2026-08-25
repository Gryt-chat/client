import type { UserStatus } from "../types/clients";

/**
 * How a member's presence is named and coloured, in one place.
 *
 * It lived inside MemberSidebar and the hover card needed the same answers.
 * Importing it back out of MemberSidebar would have made a cycle — that file
 * imports the card — so it sits here instead, which is also the honest shape:
 * neither component owns what "AFK" is called.
 */
export const statusConfig: Record<UserStatus, { label: string; color: string }> = {
  in_voice: { label: "In Voice", color: "var(--gryt-accent-9)" },
  online: { label: "Online", color: "var(--gryt-success-9)" },
  afk: { label: "AFK", color: "var(--gryt-warning-9)" },
  offline: { label: "Offline", color: "var(--gryt-neutral-9)" },
};

export const statusPriority: Record<UserStatus, number> = {
  in_voice: 0,
  online: 1,
  afk: 2,
  offline: 3,
};
