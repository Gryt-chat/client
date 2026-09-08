/**
 * How a member's invite reads on the Members tab. Deleted and revoked both mean
 * the door is shut, but they are different sentences (GRYT-923).
 */

export interface MemberInvite {
  serverUserId: string;
  code: string;
  /** What the invite was labelled, where it was. */
  note: string | null;
  /**
   * Whether it has been revoked, or null when the invite no longer exists at
   * all. Three states rather than two — see `inviteState`.
   */
  revoked: boolean | null;
  usesConsumed: number | null;
  maxUses: number | null;
}

export interface InviteState {
  /** What to show: the label if it has one, the code if not. */
  label: string;
  /** Whether anybody could still arrive on it. */
  dead: boolean;
  /** The word beside a dead one, or null when it is live. */
  reason: "revoked" | "deleted" | null;
  /** The code, and the use count where the invite is still around. */
  hint: string;
}

/**
 * `revoked !== false` rather than `revoked === true`. Null means the row is gone,
 * which is every bit as shut, and would otherwise draw as live.
 */
export function inviteState(invite: MemberInvite): InviteState {
  const dead = invite.revoked !== false;

  return {
    // The note is what an operator recognises. The code stays in `hint` because
    // that is what the Invites tab lists it under.
    label: invite.note || invite.code,
    dead,
    reason: dead ? (invite.revoked === null ? "deleted" : "revoked") : null,
    hint: [
      invite.code,
      // Only where the invite still exists. "0 of 0 used" under a deleted one
      // is a number invented to fill a gap.
      invite.maxUses ? `${invite.usesConsumed ?? 0} of ${invite.maxUses} used` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
