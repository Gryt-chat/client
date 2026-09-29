import { createContext, useContext } from "react";

import type { AdminActions } from "../MemberSidebar";

/**
 * What the server view lets a member card do, handed down once instead of through
 * every list and message that shows a card. Absent handlers leave their button out.
 */
export interface MemberCardActions {
  currentServerUserId?: string;
  currentUserRole?: string;
  adminActions?: AdminActions;
  onOpenDm?: (serverUserId: string) => void;
  onToggleBlock?: (serverUserId: string) => void;
  isBlocked?: (serverUserId: string) => boolean;
  onReport?: (target: { serverUserId: string; nickname: string }) => void;
}

export const MemberCardActionsContext = createContext<MemberCardActions>({});

export function useMemberCardActions(): MemberCardActions {
  return useContext(MemberCardActionsContext);
}

/** The hover card's popup, stripped so the card draws its own edge, colour and size. */
export const MEMBER_CARD_POPUP = "w-auto p-0 border-0 bg-transparent rounded-none";
