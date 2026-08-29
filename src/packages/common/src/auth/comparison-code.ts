/**
 * A code two people read to each other (GRYT-730).
 *
 * Everything since GRYT-720 catches a key that *changed*. None of it can say
 * the first key was ever the right one, because the server is what introduced
 * the two people and no check made through the server gets past that. This is
 * the way out, and it is the only one: two people compare a short string over
 * something the server is not on — a phone call, a doorway — and if it matches,
 * neither of them is talking to the server.
 *
 * ## What goes into it
 *
 * Everything both sides have pinned about each other: both identity
 * thumbprints and both DM public keys. A server that substituted any one of the
 * four makes the two codes differ, and there is nothing it can do about that
 * because it never sees the comparison.
 *
 * The four are sorted before hashing, so both people compute the same code
 * without having to agree on who is first. That is the whole reason for the
 * sort, and it is why the two halves are labelled rather than positional.
 *
 * ## What it cannot say
 *
 * Whose keys they are. Matching codes mean the two of you hold the keys you
 * think you hold; they say nothing about the nickname on the other end, and a
 * code compared with the wrong person matches perfectly. That is not a gap this
 * can close and no design closes it — at some point somebody recognises a voice.
 *
 * ## Digits, deliberately
 *
 * Not words. `identity-seed.ts` already renders 24 words from the BIP39 list
 * for the identity backup, and eight more words on a card beside it would read
 * as a second recovery phrase. The one thing this must never be mistaken for is
 * something worth typing into a box or keeping secret — it is public, and it is
 * meant to be read out loud.
 */

import { sha256 } from "@noble/hashes/sha2.js";

/** How many digits, and why that many. */
const GROUPS = 12;
const DIGITS_PER_GROUP = 5;

/**
 * Sixty digits is a little under 200 bits, which is far more than the work of
 * grinding a key to match matters at — the number is chosen for reading aloud
 * rather than for the margin. Twelve groups of five is what fits a card in
 * three rows and what somebody can keep their place in halfway down a phone
 * call.
 */
export const COMPARISON_CODE_DIGITS = GROUPS * DIGITS_PER_GROUP;

export interface ComparisonSide {
  /** Their identity key's JWK thumbprint, as pinned. */
  thumbprint: string;
  /** Their DM public key, base64url, as pinned. */
  dmPublicKey: string;
}

/**
 * Enough bytes for one digit each, from a hash that only produces 32.
 *
 * Counting rather than wrapping. Wrapping a 32-byte digest around 60 digits
 * repeats the first 28 of them at the end, which halves what the code actually
 * distinguishes and — worse — is visible: the printed code has a run in it that
 * looks like a bug and invites somebody to stop comparing.
 */
function stretch(seed: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let block = 0; block * 32 < count; block++) {
    const chunk = sha256(
      new Uint8Array([...seed, block]) as Uint8Array<ArrayBuffer>,
    );
    out.set(chunk.subarray(0, Math.min(32, count - block * 32)), block * 32);
  }
  return out;
}

function digitsFrom(bytes: Uint8Array, count: number): string {
  // Every digit from its own byte, taken modulo ten. That is very slightly
  // biased — 256 is not a multiple of 10 — and it does not matter here: this is
  // a fingerprint to compare, not a secret to guess. Rejection sampling would
  // buy a fraction of a bit and a branch that is hard to test.
  let out = "";
  for (let i = 0; i < count; i++) out += (bytes[i] % 10).toString();
  return out;
}

/**
 * The code for one pair.
 *
 * Both sides go in, sorted, so the two people compute the same string. Neither
 * has to know which of them is "first", and there is no ordering rule to get
 * wrong on one platform and right on another.
 */
export function comparisonCode(a: ComparisonSide, b: ComparisonSide): string {
  const halves = [
    [a.thumbprint, a.dmPublicKey],
    [b.thumbprint, b.dmPublicKey],
  ]
    .map((half) => JSON.stringify(half))
    .sort();

  /*
   * JSON rather than joining on a separator.
   *
   * `thumbprint + ":" + key` is ambiguous: a thumbprint of "a" with a key of
   * "b:c" and a thumbprint of "a:b" with a key of "c" produce the same string,
   * so two different pairs of keys get the same code. Neither field contains a
   * colon today — both are base64url — which makes it the kind of thing that is
   * fine until somebody changes what goes in here. Quoting removes the question.
   */
  const digest = sha256(
    new TextEncoder().encode(JSON.stringify(halves)) as Uint8Array<ArrayBuffer>,
  );

  const digits = digitsFrom(stretch(digest, COMPARISON_CODE_DIGITS), COMPARISON_CODE_DIGITS);
  const groups: string[] = [];
  for (let i = 0; i < COMPARISON_CODE_DIGITS; i += DIGITS_PER_GROUP) {
    groups.push(digits.slice(i, i + DIGITS_PER_GROUP));
  }
  return groups.join(" ");
}
