import { useCallback, useEffect, useMemo, useState } from "react";

import {
  decideSealing,
  type DmKeyPair,
  openAttachment,
  type OpenedMessage,
  openForConversation,
  ownDmKeyPair,
  sealAttachment,
  type SealDecision,
  type SealedAttachmentKey,
  sealForConversation,
} from "@/common";

import { useSockets } from "./useSockets";

/**
 * Whether the conversation on screen can be encrypted, and doing it. The rules
 * live in `conversation-encryption`; this is the part that has to be a hook.
 */

export interface ConversationSealing {
  /**
   * Whether the next message will be sealed, and who is stopping it if not. A
   * composer that does not draw this sends in the clear without saying so.
   */
  decision: SealDecision;
  /**
   * Null means send it as text. `attachments` is what `sealFile` handed back, so
   * the order is: encrypt and upload each file, then seal the message.
   */
  seal: (
    plaintext: string,
    attachments?: Record<string, SealedAttachmentKey>,
  ) => Promise<string | null>;
  /**
   * Encrypt one file, or null when this conversation is not being sealed. Null is
   * the ordinary answer for a channel; treating it as an error breaks uploads.
   */
  sealFile: (
    bytes: Uint8Array,
    about?: { name?: string; mime?: string; width?: number; height?: number },
  ) => { ciphertext: Uint8Array; meta: SealedAttachmentKey } | null;
  /**
   * Turn a downloaded attachment back into its bytes. Throws when they do not
   * open, which for a file has no ordinary cause.
   */
  openFile: (ciphertext: Uint8Array, meta: SealedAttachmentKey) => Uint8Array;
  /**
   * Null means there is no wrapped key for us — somebody who joined after it was
   * sent. Throws when a key is there and does not open, which is not an absence.
   */
  open: (sealed: string) => Promise<OpenedMessage | null>;
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
   * Everybody in the conversation apart from you, or null for a channel. Passed
   * in because `useDirectMessages` subscribes, and a second one is wasted.
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
    // cannot leave one server's keys in place while another's are derived.
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
    // A channel, or a conversation this client does not know yet. Neither is
    // sealable and neither is anybody's fault, so `blockedBy` stays empty.
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
    async (plaintext: string, attachments?: Record<string, SealedAttachmentKey>) => {
      if (!keys) return null;
      return sealForConversation({
        plaintext,
        conversationId,
        senderKeys: keys,
        decision,
        attachments,
      });
    },
    [keys, conversationId, decision],
  );

  const sealFile = useCallback(
    (
      bytes: Uint8Array,
      about?: { name?: string; mime?: string; width?: number; height?: number },
    ) => {
      // The same condition the text obeys, checked here rather than trusted: a
      // file sealed for a message that goes out plain is an upload nobody opens.
      if (decision.kind !== "seal") return null;

      return sealAttachment({ bytes, conversationId, ...about });
    },
    [conversationId, decision],
  );

  const openFile = useCallback(
    (ciphertext: Uint8Array, meta: SealedAttachmentKey) =>
      openAttachment({ ciphertext, conversationId, meta }),
    [conversationId],
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

  /* Stable identity: `useChat` has an effect that depends on this, and a new
     object every render re-ran it every render. */
  return useMemo(
    () => ({ decision, seal, sealFile, openFile, open }),
    [decision, seal, sealFile, openFile, open],
  );
}
