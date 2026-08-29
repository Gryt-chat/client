/**
 * What a member list does to your pins (GRYT-727).
 *
 * `peer-keys.ts` decides about one binding. This is the policy over a whole
 * list, and the policy is where the mistakes are: pinning on a change instead
 * of on a first sighting turns the design off and nothing on screen looks
 * different, and pinning your own row means a server that rewrites your key
 * gets it pinned by you.
 *
 * Here rather than in the socket package so a check can import it. The socket
 * half of GRYT-727 is one `emit` and one `then`; this is the part with
 * decisions in it, and it kept none of them within reach of a test while it
 * lived behind a Vite alias.
 */

import type { IdentityScope } from "./identity-seed";
import { evaluatePeerKey, type PeerKeyDecision, pinPeerKey } from "./peer-keys.ts";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface MemberKeyState {
  decision: PeerKeyDecision;
  /** Whether this row is the person running this client. */
  isSelf: boolean;
  /**
   * Set only on your own row, and only when it disagrees with what you hold.
   *
   * You know what your key on this server should be, because you derived it, so
   * a member list showing something else under your own id is this server
   * rewriting it (GRYT-727). It is the one check a single person can run with
   * nobody else involved — and it catches only the careless version, because an
   * operator can serve you the truth and everybody else a lie. Combined with
   * keys riding the member list, the lie then has to hold in front of every
   * member at once.
   */
  ownKeyRewritten?: boolean;
}

/**
 * Work out what to do about every binding in a member list.
 *
 * `first` is pinned here, because that is what trust on first use means and
 * there is nobody to ask. `changed` is returned untouched and never pinned:
 * somebody has to decide, and a client that re-pinned on its own would have
 * thrown away the only protection this design has.
 */
export async function evaluateMemberKeys({
  scope,
  ownKey,
  members,
  myServerUserId,
}: {
  scope: IdentityScope;
  /**
   * The DM public key this device uses on this server, from `ownDmPublicKey`.
   *
   * The public half and nothing more. Taking the seed instead would work and
   * would mean the master secret leaving the module that owns the database, to
   * compute a value that module already exposes.
   *
   * Null when it cannot be worked out, which turns the self-check off rather
   * than making it fail.
   */
  ownKey: Uint8Array | null;
  members: { serverUserId: string; dmKeyBinding?: string | null }[];
  /** Null before the member list has said which row is yours. */
  myServerUserId: string | null;
}): Promise<Record<string, MemberKeyState>> {
  // Derived once rather than per member, and only when there is a row to check
  // it against.
  const mine = ownKey && myServerUserId ? base64Url(ownKey) : null;

  const states: Record<string, MemberKeyState> = {};

  for (const member of members) {
    const isSelf = member.serverUserId === myServerUserId;

    const decision = await evaluatePeerKey({
      scope,
      memberId: member.serverUserId,
      binding: member.dmKeyBinding,
    });

    if (decision.kind === "first" && !isSelf) {
      pinPeerKey(scope, member.serverUserId, decision.verified);
    }

    const state: MemberKeyState = { decision, isSelf };

    if (isSelf && mine && decision.kind !== "none") {
      const shown =
        decision.kind === "unusable" ? null : base64Url(decision.verified.dmPublicKey);
      // An unusable binding on your own row counts too: you published something
      // that verifies, so whatever is being shown is not it.
      state.ownKeyRewritten = shown !== mine;
    }

    states[member.serverUserId] = state;
  }

  return states;
}
