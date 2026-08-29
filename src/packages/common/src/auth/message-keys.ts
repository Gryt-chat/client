/**
 * One key per message, wrapped once per member (GRYT-718).
 *
 * `dm-keys.ts` gives two people a shared secret. Three people do not have one,
 * and a group is what `conversations.ts` calls a conversation with `kind:
 * "group"` — so the shape here is the one GRYT-709 picked: a random key for the
 * message, encrypted once for each member with the secret the sender shares
 * with that member.
 *
 * It scales with the member cap the server already enforces rather than with
 * anything unbounded, and it needs no group ratchet, no key agreement between
 * the members themselves, and nothing kept between messages.
 *
 * ## Membership changes stop being a policy question
 *
 * `conversations.ts` worries about a message "becoming readable by a third
 * because somebody tapped add", and today it answers by refusing to turn a
 * one-to-one into a group. Here the answer is structural: somebody added
 * afterwards has no wrapped key in any message sent before they arrived, so
 * those messages stay unreadable to them. Nothing enforces that; there is
 * simply nothing for them to open.
 *
 * The reverse holds too. Removing somebody does not take back what they could
 * already read, and no design can — they had the key.
 *
 * ## What this is not
 *
 * **Not authenticated as coming from the sender.** Everyone holding the content
 * key can encrypt with it, so any member could produce a message the others
 * decrypt happily. Saying *who wrote it* is a signature with the identity key,
 * and that is not here yet.
 *
 * **Not end-to-end against the server, yet.** Wrapping to a public key is only
 * worth something if the public key belongs to who you think. That is the
 * certificate GRYT-709 describes, and until a peer can check one themselves a
 * caller is trusting the server for it. `dmSharedSecret` says the same thing
 * from the other end.
 *
 * **Not private about who is in the conversation.** The wrapped keys are listed
 * by member id, so a sealed message names its own recipients. The server that
 * stores it already stores the membership, so this gives away nothing it did
 * not have — but it does mean the ciphertext is not anonymous on its own.
 */

/*
 * The `.ts` is deliberate, and it is the only import in `src/` that carries one.
 *
 * `scripts/check-message-keys.mjs` runs this file through Node's type
 * stripping, which does no extension inference — extensionless, Node looks for
 * `dm-keys` on disk, does not find it, and the check cannot run at all. Vite and
 * `tsc` both resolve the explicit extension, and `allowImportingTsExtensions` is
 * already on in `tsconfig.app.json`.
 */
import { gcm } from "@noble/ciphers/aes.js";

import { type DmKeyPair, dmSharedSecret } from "./dm-keys.ts";

const IV_BYTES = 12;
const CONTENT_KEY_BYTES = 32;

export const SEALED_MESSAGE_TYPE = "gryt-sealed-message";

/** One member's copy of the content key. */
export interface WrappedKey {
  iv: string;
  key: string;
}

export interface SealedMessage {
  type: typeof SEALED_MESSAGE_TYPE;
  version: 1;
  /**
   * The sender's DM public key, base64url.
   *
   * Here because a reader needs it to derive the secret that opens their
   * wrapped key, and the sender is not always somebody the reader has looked up
   * — a member can leave. It is *not* proof of who sent this; see the header.
   */
  sender: string;
  /** The body's nonce. */
  iv: string;
  /** The message, encrypted with the content key. */
  body: string;
  /** Member id to that member's wrapped copy of the content key. */
  keys: Record<string, WrappedKey>;
}

export interface Recipient {
  /** How the conversation names this person. `conversation_members.user_id`. */
  memberId: string;
  /** Their DM public key, as `dmPublicKey` returns it. */
  publicKey: Uint8Array;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes as Uint8Array<ArrayBuffer>;
}

/**
 * AES-256-GCM, from a library rather than from the platform (GRYT-733).
 *
 * `crypto.subtle` is not on React Native, and this file has to run there
 * unchanged — two implementations of one envelope is a pair of clients that
 * send each other messages nobody can read, with the sender looking at the text
 * they typed either way.
 *
 * The bytes are the same. A twelve-byte nonce, a sixteen-byte tag appended to
 * the ciphertext, additional data authenticated and not encrypted: that is what
 * WebCrypto produced and what this produces, so everything sealed before this
 * change still opens.
 */
function aesGcm(key: Uint8Array, iv: Uint8Array, aad: Uint8Array) {
  return gcm(key as Uint8Array<ArrayBuffer>, iv as Uint8Array<ArrayBuffer>, aad as Uint8Array<ArrayBuffer>);
}

/**
 * What the body is bound to, so it cannot be moved somewhere it does not belong.
 *
 * AES-GCM's additional data is authenticated but not encrypted, and decryption
 * fails if it differs. Putting the conversation id in means a sealed message
 * lifted out of one conversation and posted into another does not open, even
 * though the same people and the same keys are involved — without it, the same
 * pair talking in two conversations could have a message replayed between them.
 *
 * The sender goes in for the same reason: re-labelling a message as somebody
 * else's breaks it. That is a much weaker thing than a signature — a member with
 * the content key can seal a fresh message under any sender they like — but it
 * costs nothing and closes the lazier version.
 */
function bodyContext(conversationId: string, sender: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${SEALED_MESSAGE_TYPE}/v1/${conversationId}/${sender}`,
  ) as Uint8Array<ArrayBuffer>;
}

/** The same, for one member's wrapped key. */
function wrapContext(
  conversationId: string,
  sender: string,
  memberId: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `${SEALED_MESSAGE_TYPE}/v1/${conversationId}/${sender}/${memberId}`,
  ) as Uint8Array<ArrayBuffer>;
}

/**
 * Encrypt a message and wrap its key for everybody who should read it.
 *
 * `recipients` is the whole membership, **including the sender**. Leaving the
 * sender out compiles, sends, and produces a conversation the sender cannot
 * read back — which is not something a type or a running app makes obvious,
 * because the sender is looking at the plaintext they just typed. So it is
 * checked here rather than left to every caller.
 *
 * The sender's own entry is wrapped with `dmSharedSecret(theirPrivate,
 * theirPublic, …)`, which is a perfectly ordinary X25519 agreement that happens
 * to have the same key on both sides. Nobody else can compute it.
 */
export async function sealMessage({
  plaintext,
  conversationId,
  senderKeys,
  recipients,
}: {
  plaintext: string;
  conversationId: string;
  senderKeys: DmKeyPair;
  recipients: Recipient[];
}): Promise<SealedMessage> {
  if (recipients.length === 0) {
    throw new Error("A message with no recipients cannot be read by anybody.");
  }

  const seen = new Set<string>();
  for (const { memberId } of recipients) {
    if (seen.has(memberId)) {
      throw new Error(`Member ${memberId} is in the recipient list twice.`);
    }
    seen.add(memberId);
  }

  const sender = base64Url(senderKeys.publicKey);
  if (!recipients.some((r) => base64Url(r.publicKey) === sender)) {
    throw new Error(
      "The sender is not among the recipients, so they could not read this back.",
    );
  }

  const contentKey = randomBytes(CONTENT_KEY_BYTES);
  const iv = randomBytes(IV_BYTES);

  const body = aesGcm(contentKey, iv, bodyContext(conversationId, sender)).encrypt(
    new TextEncoder().encode(plaintext) as Uint8Array<ArrayBuffer>,
  );

  const keys: Record<string, WrappedKey> = {};
  for (const recipient of recipients) {
    const secret = dmSharedSecret(
      senderKeys.privateKey,
      recipient.publicKey,
      conversationId,
    );
    const wrapIv = randomBytes(IV_BYTES);
    const wrapped = aesGcm(
      secret,
      wrapIv,
      wrapContext(conversationId, sender, recipient.memberId),
    ).encrypt(contentKey);
    keys[recipient.memberId] = {
      iv: base64Url(wrapIv),
      key: base64Url(wrapped),
    };
  }

  return {
    type: SEALED_MESSAGE_TYPE,
    version: 1,
    sender,
    iv: base64Url(iv),
    body: base64Url(body),
    keys,
  };
}

/**
 * Read a message, if this member has a key for it.
 *
 * Returns null when there is no wrapped key for `memberId` — somebody who
 * joined after this was sent, or a message that was never addressed to them.
 * That is an ordinary outcome and not an error: a client rendering a
 * conversation will hit it whenever somebody was added, and it should draw
 * something honest rather than throw.
 *
 * A key that is present and does not open, on the other hand, throws. That
 * means tampering, the wrong conversation, or the wrong keys, and swallowing it
 * would show an empty message where something is actually wrong.
 */
export async function openMessage({
  sealed,
  conversationId,
  memberId,
  recipientKeys,
}: {
  sealed: SealedMessage;
  conversationId: string;
  /** Which member you are, as the conversation names you. */
  memberId: string;
  recipientKeys: DmKeyPair;
}): Promise<string | null> {
  if (sealed.type !== SEALED_MESSAGE_TYPE || sealed.version !== 1) {
    throw new Error("That is not a sealed message this version can read.");
  }

  const mine = sealed.keys[memberId];
  if (!mine) return null;

  const secret = dmSharedSecret(
    recipientKeys.privateKey,
    fromBase64Url(sealed.sender),
    conversationId,
  );

  const contentKey = aesGcm(
    secret,
    fromBase64Url(mine.iv),
    wrapContext(conversationId, sealed.sender, memberId),
  ).decrypt(fromBase64Url(mine.key));

  const plain = aesGcm(
    contentKey,
    fromBase64Url(sealed.iv),
    bodyContext(conversationId, sealed.sender),
  ).decrypt(fromBase64Url(sealed.body));

  return new TextDecoder().decode(plain);
}
