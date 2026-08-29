/**
 * The key a direct message is encrypted to (GRYT-709).
 *
 * Separate from the identity key on purpose, and not because it is tidier. The
 * identity key is ECDSA P-256, which signs and cannot do key agreement — there
 * is no operation that turns two ECDSA keys into a shared secret. Encryption
 * needs a curve built for agreement, so this is X25519 and it is a second key.
 *
 * ## Nothing secret ever leaves the device
 *
 * Only {@link dmPublicKey} is published. The private half is derived here, used
 * here, and never sent anywhere — not to the server, not encrypted, not as part
 * of a backup. A server that wanted to read a conversation would have to obtain
 * something that has never been transmitted.
 *
 * What *is* backed up is the seed, which the 24-word phrase already carries. So
 * restoring an identity restores the ability to read old messages, without
 * anything about the messages being stored anywhere but the server that already
 * has them.
 *
 * ## One key per server, like the identity key
 *
 * `identity-seed.ts` derives a separate key for each host so that two servers
 * cannot tell they are talking to the same person. That property is worth
 * exactly as much here, and would be undone by a single DM key shared across
 * servers — so the host goes into the derivation the same way.
 *
 * The consequence is that a conversation is bound to the server it happens on,
 * which is what `useDirectMessages.ts` and `conversations.ts` already say about
 * DMs in plaintext. Encryption does not change the shape, it enforces it.
 *
 * ## What this file does not do
 *
 * It derives a keypair and computes a shared secret. It does not publish the
 * public key, does not encrypt a message, and does not know what a conversation
 * is. Wrapping a per-message key for each member, and the certificate that says
 * whose public key is whose, are the parts that follow — and the certificate is
 * the one that decides whether any of this is worth anything, because a shared
 * secret with a key the server chose for you protects nothing.
 */

import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Domain separator, and why it is not the identity one.
 *
 * `identity-seed.ts` uses `gryt-identity-v1`. Deriving both keys from one seed
 * under the same label would hand the same 32 bytes to two different
 * algorithms, which is the kind of reuse that turns two safe primitives into
 * one unsafe system. A different label makes the two keys independent: knowing
 * either tells you nothing about the other, because HKDF's outputs for
 * different `info` are unrelated to anyone without the seed.
 *
 * Versioned for the same reason the identity one is. Changing this string
 * changes every DM key that has ever existed, which would make every message
 * already sent unreadable — so a `v2` arrives with a migration or not at all.
 */
const DERIVATION_SALT = "gryt-dm-v1";

/**
 * Exactly 32, and this is where X25519 differs from the P-256 path next door.
 *
 * `deriveLocalKeyPair` takes 48 bytes and reduces them modulo the curve order,
 * because a P-256 scalar has to land in a range that 32 uniform bytes overshoot
 * slightly, and the excess makes low values fractionally likelier.
 *
 * X25519 has no such range. Any 32 bytes is a valid secret — the algorithm
 * clamps the bits it cares about itself, which is part of its definition rather
 * than something a caller does. So taking more than 32 and reducing would be
 * ceremony that copies the shape of the other function without its reason.
 */
const SECRET_BYTES = 32;

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

/**
 * Refuse a seed this obviously cannot be right.
 *
 * The mirror of `assertUsableSeed` in `identity-seed.ts`, and here for the same
 * reason: a stub or a platform handing back a constant would give every device
 * the same DM key, and every user would be able to read every conversation. A
 * real seed being all one byte has a probability around 2^-248, so nothing
 * legitimate is being turned away.
 */
function assertUsableSeed(seed: Uint8Array): void {
  if (seed.length !== SECRET_BYTES) {
    throw new Error(`A seed is ${SECRET_BYTES} bytes, not ${seed.length}.`);
  }
  if (seed.every((byte) => byte === seed[0])) {
    throw new Error("That seed is a single repeated byte, which is not a seed.");
  }
}

export interface DmKeyPair {
  /** Never leaves this device. Not sent, not backed up, not logged. */
  privateKey: Uint8Array;
  /** The half that is published, so others can encrypt to you. */
  publicKey: Uint8Array;
}

/**
 * The DM keypair this seed gives for one server.
 *
 * Deterministic: the same seed and host give the same keypair on any device,
 * which is what makes the recovery phrase enough to read old conversations
 * again.
 *
 * Raw bytes rather than a `CryptoKey`, because WebCrypto's X25519 support is
 * younger than the browsers Gryt runs on and the agreement below is done by the
 * curve library anyway. There is nothing to gain from importing a key into an
 * API that is not going to perform the operation.
 */
export function deriveDmKeyPair(seed: Uint8Array, host: string): DmKeyPair {
  assertUsableSeed(seed);

  const privateKey = hkdf(
    sha256,
    seed,
    utf8(DERIVATION_SALT),
    utf8(host),
    SECRET_BYTES,
  );

  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** The public half alone, for the cases that should not touch the private one. */
export function dmPublicKey(seed: Uint8Array, host: string): Uint8Array {
  return deriveDmKeyPair(seed, host).publicKey;
}

/**
 * The secret two people share, from one private half and one public half.
 *
 * Run through HKDF rather than used raw. The X25519 output is a curve point's
 * x-coordinate, which is not uniformly distributed over 32 bytes, and a key
 * derivation function is what turns it into something safe to use as one. The
 * conversation id goes in as `info`, so the same pair of people talking in two
 * conversations do not derive the same key in both.
 *
 * **This is not enough on its own, and the gap is not in the maths.** Agreement
 * with the wrong public key succeeds exactly as well as agreement with the right
 * one — both produce a perfectly good secret. Whether `theirPublicKey` belongs
 * to the person named beside it is the question the certificate answers, and
 * until that exists a caller is trusting the server for it.
 */
export function dmSharedSecret(
  privateKey: Uint8Array,
  theirPublicKey: Uint8Array,
  conversationId: string,
): Uint8Array {
  const shared = x25519.getSharedSecret(privateKey, theirPublicKey);
  return hkdf(
    sha256,
    shared,
    utf8(`${DERIVATION_SALT}-shared`),
    utf8(conversationId),
    SECRET_BYTES,
  );
}
