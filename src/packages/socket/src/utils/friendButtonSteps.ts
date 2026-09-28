import type { FriendAction } from "../hooks/friendsStore";
import type { FriendState } from "./friendList";

/** Which icon a step draws. FriendButton.tsx owns the mapping to a component. */
export type FriendStepIcon = "add" | "clock" | "check" | "close" | "confirm";

export interface FriendStepConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface FriendStep {
  /** "confirm" isn't a server action -- it only ever runs confirmServerFriend. */
  action: FriendAction | "confirm";
  label: string;
  icon: FriendStepIcon;
  tone: "primary" | "ghost";
  /** The longer explanation: a tooltip where there's no room for a caption, a caption where there is. */
  hint: string;
  /** Set only for an action that shouldn't fire on the first click. */
  confirm?: FriendStepConfirm;
}

/**
 * What a friend state offers next, and what each offer should say (GRYT-1573).
 * `name` is the other person's nickname, or "them" where the caller has none.
 */
export function friendButtonSteps(state: FriendState, name: string): FriendStep[] {
  switch (state) {
    case "none":
      return [{ action: "request", label: "Add friend", icon: "add", tone: "ghost", hint: `Add ${name} as a friend` }];

    case "outgoing":
      return [{
        action: "cancel",
        label: "Requested",
        icon: "clock",
        tone: "ghost",
        hint: `Waiting for ${name} to accept. Click to cancel.`,
        confirm: {
          title: "Cancel friend request?",
          description: `Cancel your friend request to ${name}?`,
          confirmLabel: "Cancel request",
          cancelLabel: "Keep waiting",
        },
      }];

    case "incoming":
      return [
        { action: "accept", label: "Accept", icon: "check", tone: "primary", hint: `Accept ${name}'s friend request` },
        { action: "decline", label: "Decline", icon: "close", tone: "ghost", hint: `Decline ${name}'s friend request` },
      ];

    case "unconfirmed":
      return [{
        action: "confirm",
        label: "Confirm friend",
        icon: "confirm",
        tone: "ghost",
        hint: `${name} already has you as a friend on another device`,
      }];

    case "friend":
      return [];
  }
}
