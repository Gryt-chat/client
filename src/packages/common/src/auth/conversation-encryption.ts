/**
 * Whether a conversation can be encrypted, and doing it (GRYT-729).
 *
 * Everything underneath this has existed for a while and had no caller.
 * `sealMessage` since GRYT-718, keys published and pinned since GRYT-727. This
 * is the decision that turns them on, and it is a decision rather than a
 * capability check: it can say no, and when it says no the answer has to reach
 * the person about to press send.
 *
 * ## Every member, or nobody
 *
 * A message is sealed only when every member of the conversation has a key this
 * client is willing to use. One member without one is not a reason to seal for
 * the rest — they would be unable to read a conversation they are in, silently,
 * and the sender would have no idea.
 *
 * A member whose key *changed* counts as not having one. That is the refusal
 * from GRYT-726 arriving where it matters: nothing is encrypted to a key this
 * client has decided not to trust, and nothing falls back to plaintext without
 * saying so either.
 *
 * ## Saying no out loud
 *
 * {@link SealDecision} carries who is missing and why. A composer that quietly
 * sends in the clear because somebody has not updated their client is the exact
 * failure this whole design exists to avoid, and it is invisible from the
 * outside — the message sends, it arrives, it reads normally.
 */

import { openMessage, type SealedMessage,sealMessage } from "./message-keys.ts";
import { type PeerKeyDecision } from "./peer-keys.ts";

export interface ConversationMember {
  /** `server_user_id`, which is how the conversation names them. */
  memberId: string;
  /** What this client decided about their key, from `evaluateMemberKeys`. */
  keyState?: { decision: PeerKeyDecision } | undefined;
}

export type SealDecision =
  | { kind: "seal"; recipients: { memberId: string; publicKey: Uint8Array }[] }
  | {
      kind: "plaintext";
      /**
       * Why, per member, so a composer can name them rather than saying
       * "encryption unavailable" and leaving somebody to guess.
       */
      blockedBy: { memberId: string; reason: "no-key" | "changed" | "unusable" }[];
    };

/**
 * Can this conversation be sealed, and to whom.
 *
 * `self` is included in the recipients, because a sender who cannot read their
 * own message back has sent something they will look at tomorrow and find
 * empty. `sealMessage` refuses a recipient list without them for that reason;
 * this is where they are put in.
 */
export function decideSealing({
  members,
  self,
}: {
  /** Everybody in the conversation apart from you. */
  members: ConversationMember[];
  /** Your own member id and DM public key on this server. */
  self: { memberId: string; publicKey: Uint8Array } | null;
}): SealDecision {
  if (!self) {
    // No key of our own means nothing to seal with, which is a device that has
    // not finished joining rather than a problem with anybody else.
    return { kind: "plaintext", blockedBy: [] };
  }

  const recipients: { memberId: string; publicKey: Uint8Array }[] = [
    { memberId: self.memberId, publicKey: self.publicKey },
  ];
  const blockedBy: { memberId: string; reason: "no-key" | "changed" | "unusable" }[] = [];

  for (const member of members) {
    const decision = member.keyState?.decision;

    if (!decision || decision.kind === "none") {
      blockedBy.push({ memberId: member.memberId, reason: "no-key" });
      continue;
    }
    if (decision.kind === "unusable") {
      blockedBy.push({ memberId: member.memberId, reason: "unusable" });
      continue;
    }
    if (decision.kind === "changed") {
      // The refusal from GRYT-726, arriving where it costs something. Falling
      // back to plaintext here is the honest answer; encrypting to the new key
      // would be pretending the change was fine.
      blockedBy.push({ memberId: member.memberId, reason: "changed" });
      continue;
    }

    recipients.push({
      memberId: member.memberId,
      publicKey: decision.verified.dmPublicKey,
    });
  }

  if (blockedBy.length > 0) return { kind: "plaintext", blockedBy };
  return { kind: "seal", recipients };
}

/**
 * Seal a message for a conversation, or say why it cannot be.
 *
 * Returns the envelope as the string that goes on the wire. Null means send it
 * in the clear — and a caller that ignores which of the two it got is back to
 * sending plaintext without telling anybody.
 */
export async function sealForConversation({
  plaintext,
  conversationId,
  senderKeys,
  decision,
}: {
  plaintext: string;
  conversationId: string;
  senderKeys: { privateKey: Uint8Array; publicKey: Uint8Array };
  decision: SealDecision;
}): Promise<string | null> {
  if (decision.kind !== "seal") return null;

  const sealed = await sealMessage({
    plaintext,
    conversationId,
    senderKeys,
    recipients: decision.recipients,
  });

  return JSON.stringify(sealed);
}

/**
 * Read one back.
 *
 * Null when there is no wrapped key for this member — somebody who joined after
 * it was sent — which a client draws as a message it cannot read rather than as
 * an error. Anything else throws, because a key that is present and does not
 * open means tampering or the wrong conversation, and an empty bubble would
 * hide it.
 */
export async function openForConversation({
  sealed,
  conversationId,
  memberId,
  recipientKeys,
}: {
  /** The string off the wire. */
  sealed: string;
  conversationId: string;
  memberId: string;
  recipientKeys: { privateKey: Uint8Array; publicKey: Uint8Array };
}): Promise<string | null> {
  let envelope: SealedMessage;
  try {
    envelope = JSON.parse(sealed);
  } catch {
    throw new Error("That message is not a sealed envelope.");
  }

  return openMessage({ sealed: envelope, conversationId, memberId, recipientKeys });
}
