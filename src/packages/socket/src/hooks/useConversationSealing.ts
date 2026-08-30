import { useCallback, useEffect, useMemo, useState } from "react";

import {
  decideSealing,
  type DmKeyPair,
  openForConversation,
  ownDmKeyPair,
  type SealDecision,
  sealForConversation,
} from "@/common";

import { useSockets } from "./useSockets";

/**
 * Whether the conversation on screen can be encrypted, and doing it (GRYT-729).
 *
 * Pulls together the three things that decide it — who is in the conversation,
 * what this client made of each of their keys, and this device's own keypair —
 * and hands back a decision plus the two operations. Everything with a rule in
 * it lives in `conversation-encryption` in `@gryt/crypto`; this is the part that
 * has to be a hook because the inputs are React state.
 */

export interface ConversationSealing {
  /**
   * Whether the next message will be sealed, and who is stopping it if not.
   *
   * A composer that does not draw this is back to sending in the clear without
   * saying so, which is the failure the design exists to avoid.
   */
  decision: SealDecision;
  /** Null means send it as text. */
  seal: (plaintext: string) => Promise<string | null>;
  /**
   * Null means there is no wrapped key for us — somebody who joined after it
   * was sent. Throws when a key is there and does not open, which is tampering
   * or the wrong conversation rather than an ordinary absence.
   */
  open: (sealed: string) => Promise<string | null>;
}

export function useConversationSealing({
  serverHost,
  conversationId,
  myServerUserId,
  members,
}: {
  serverHost: string;
  conversationId: string;
  myServerUserId?: string;
  /**
   * Everybody in the conversation apart from you, or null for a channel.
   *
   * Passed in rather than looked up, because `useDirectMessages` takes a socket
   * and subscribes — calling it here would open a second subscription to the
   * same events for the sake of a list the caller already has.
   */
  members: { server_user_id: string }[] | null;
}): ConversationSealing {
  const { memberKeyStates } = useSockets();
  const [keys, setKeys] = useState<DmKeyPair | null>(null);

  useEffect(() => {
    if (!serverHost) {
      setKeys(null);
      return;
    }

    // Cancelled on a host change rather than left to land, so switching servers
    // quickly cannot leave one server's keys in place while another's are being
    // derived.
    let live = true;
    void ownDmKeyPair(serverHost)
      .then((pair) => {
        if (live) setKeys(pair);
      })
      .catch(() => {
        if (live) setKeys(null);
      });

    return () => {
      live = false;
    };
  }, [serverHost]);

  const decision = useMemo<SealDecision>(() => {
    // A channel, or a conversation this client does not know about yet. Neither
    // is sealable and neither is anybody's fault, so `blockedBy` stays empty and
    // a composer draws nothing rather than naming a member.
    if (!members) return { kind: "plaintext", blockedBy: [] };

    return decideSealing({
      members: members.map((member) => ({
        memberId: member.server_user_id,
        keyState: memberKeyStates[serverHost]?.[member.server_user_id],
      })),
      self:
        keys && myServerUserId
          ? { memberId: myServerUserId, publicKey: keys.publicKey }
          : null,
    });
  }, [members, memberKeyStates, serverHost, keys, myServerUserId]);

  const seal = useCallback(
    async (plaintext: string) => {
      if (!keys) return null;
      return sealForConversation({
        plaintext,
        conversationId,
        senderKeys: keys,
        decision,
      });
    },
    [keys, conversationId, decision],
  );

  const open = useCallback(
    async (sealed: string) => {
      if (!keys || !myServerUserId) return null;
      return openForConversation({
        sealed,
        conversationId,
        memberId: myServerUserId,
        recipientKeys: keys,
      });
    },
    [keys, conversationId, myServerUserId],
  );

  return { decision, seal, open };
}
