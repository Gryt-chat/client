/**
 * How a member's invite reads on the Members tab (GRYT-923).
 *
 * Pure and on its own because the states are easy to get subtly wrong and
 * impossible to check by looking: an invite that was deleted and one that was
 * revoked both mean "this door is shut", but they are different sentences, and
 * a live one must never be drawn as either.
 */

export interface MemberInvite {
  serverUserId: string;
  code: string;
  /** What the invite was labelled, where it was. */
  note: string | null;
  /**
   * Whether it has been revoked, or null when the invite no longer exists at
   * all. Three states rather than two, and the difference is worth keeping —
   * see `inviteState`.
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
 * `revoked !== false` rather than `revoked === true`.
 *
 * Null means the invite row is gone — somebody deleted it after this member
 * arrived — and that is every bit as shut as a revoked one. Testing for `true`
 * would leave a deleted invite drawn as live, with a Revoke button that acts on
 * a code the server no longer has.
 */
export function inviteState(invite: MemberInvite): InviteState {
  const dead = invite.revoked !== false;

  return {
    // The note is what an operator recognises. "Kari's friends" beats a random
    // string, and the code stays in `hint` because that is what the Invites tab
    // lists it under.
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
