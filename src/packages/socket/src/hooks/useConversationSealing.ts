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
 * Whether the conversation on screen can be encrypted, and doing it (GRYT-729).
 *
 * Everything with a rule in it lives in `conversation-encryption` in
 * `@gryt/crypto`; this is the part that has to be a hook because the inputs —
 * who is in the conversation, what this client made of each of their keys, and
 * this device's own keypair — are React state.
 */

export interface ConversationSealing {
  /**
   * Whether the next message will be sealed, and who is stopping it if not.
   *
   * A composer that does not draw this is back to sending in the clear without
   * saying so, which is the failure the design exists to avoid.
   */
  decision: SealDecision;
  /**
   * Null means send it as text.
   *
   * `attachments` is what `sealFile` handed back, keyed by the file id the
   * server assigned — so the two calls happen in that order: encrypt and upload
   * each file, then seal the message that carries their keys.
   */
  seal: (
    plaintext: string,
    attachments?: Record<string, SealedAttachmentKey>,
  ) => Promise<string | null>;
  /**
   * Encrypt one file, or null when this conversation is not being sealed.
   *
   * Null is the ordinary answer for a channel, and it means upload the file as
   * it is. A caller that treats null as an error stops people sending pictures
   * in a channel.
   *
   * The bytes are not bound to the server's file id, because there is not one
   * yet — `meta.id` is a value the package chooses. See `sealAttachment`.
   */
  sealFile: (
    bytes: Uint8Array,
    about?: { name?: string; mime?: string; width?: number; height?: number },
  ) => { ciphertext: Uint8Array; meta: SealedAttachmentKey } | null;
  /**
   * Turn a downloaded attachment back into its bytes.
   *
   * Throws when they do not open, which for a file has no ordinary cause — a
   * reader either has the message's key or does not have the message.
   */
  openFile: (ciphertext: Uint8Array, meta: SealedAttachmentKey) => Uint8Array;
  /**
   * Null means there is no wrapped key for us — somebody who joined after it
   * was sent. Throws when a key is there and does not open, which is tampering
   * or the wrong conversation rather than an ordinary absence.
   *
   * `attachments` is the file keys the message carried, by file id, and empty
   * for the messages that have none.
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
      // The same condition the text obeys, and it has to be checked here rather
      // than trusted from the caller: a file encrypted for a conversation whose
      // message then goes out as plaintext is an upload nobody can ever open,
      // and it would sit in the operator's storage forever.
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
