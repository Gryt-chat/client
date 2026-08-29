/**
 * Trust-on-first-use pinning of the people you talk to (GRYT-726).
 *
 * `dm-key-binding.ts` can check that a DM key and an identity key were chosen
 * by the same person. It cannot say who that person is, and nothing in band
 * can — so what makes a binding worth anything is that the same one keeps
 * arriving. This is the module that remembers.
 *
 * `server-pins.ts` does exactly this for servers and has since GRYT-51. Same
 * three moves: record on first sight, notice a change, refuse it. The shapes are
 * deliberately similar and the storage is deliberately separate, because a
 * server key and a person's key answer different questions, and one being
 * forgotten should not take the other with it.
 *
 * ## Refusing is the feature
 *
 * A client that quietly encrypts to a new key once the old one stops matching
 * has thrown away the only protection this design has. There is no automatic
 * re-pin here at all. A change is reported and stays reported until somebody
 * decides, because the two reasons for one — a person restored a different seed,
 * or a server substituted a key — look identical from here, and only one of them
 * is the person's own doing.
 *
 * ## Both halves are compared, not just the identity
 *
 * An account holder's identity key is generated once and kept; their DM key is
 * derived from the seed. Somebody who restores a different seed therefore keeps
 * the same identity key and arrives with a different DM key, and comparing only
 * the thumbprint would wave that through. Comparing only the DM key misses the
 * reverse. Both, or the check has a hole in whichever direction is left out.
 *
 * This module decides. It does not fetch, encrypt, or draw anything.
 */

import {
  type VerifiedDmKeyBinding,
  verifyDmKeyBinding,
} from "./dm-key-binding.ts";
import type { IdentityScope } from "./identity-seed";

const PINS_KEY = "peerDmKeyPins";

export interface PeerPin {
  /** The identity key that signed the binding, as a JWK thumbprint. */
  thumbprint: string;
  /** The DM public key it vouched for, base64url. */
  dmPublicKey: string;
  firstSeenAt: number;
  lastSeenAt: number;
}

export type PeerKeyDecision =
  /** They have published nothing. Nothing to encrypt to, and nothing wrong. */
  | { kind: "none" }
  /**
   * Something arrived and did not check out — a signature that fails, a binding
   * signed for another server, a shape that is not one at all.
   *
   * Not the same as a changed key. This is a server sending something broken
   * rather than something plausible, and it never becomes a pin.
   */
  | { kind: "unusable"; reason: string }
  /** Nobody pinned yet. The caller pins this and carries on. */
  | { kind: "first"; verified: VerifiedDmKeyBinding }
  /** The same person and the same keys as last time. */
  | { kind: "known"; verified: VerifiedDmKeyBinding; pin: PeerPin }
  /**
   * Different from what was pinned. Refuse, say so, and let somebody decide.
   *
   * `changedIdentity` and `changedKey` are separate because they mean different
   * things to a person: a new identity key is somebody arriving as a different
   * account, and a new DM key under the same identity is usually a restored
   * seed.
   */
  | {
      kind: "changed";
      pin: PeerPin;
      verified: VerifiedDmKeyBinding;
      changedIdentity: boolean;
      changedKey: boolean;
    };

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * One pin per server and member.
 *
 * A `server_user_id` is already per-server, so the scope is redundant for
 * uniqueness. It is in the key anyway so that forgetting a server forgets the
 * people on it, and so nothing rests on ids from two servers never colliding.
 */
function pinKey(scope: IdentityScope, memberId: string): string {
  return `${scope} ${memberId}`;
}

function readAll(): Record<string, PeerPin> {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Unreadable storage is not the same as no pins, and an empty map here
    // means every peer reads as "first" and gets re-pinned. That is the wrong
    // answer and there is no better one available — the same trade
    // `server-pins.ts` makes, for the same reason.
    return {};
  }
}

function writeAll(pins: Record<string, PeerPin>): void {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // Full or blocked. The decision has already been made and returned; this
    // loses the memory of it rather than the answer.
  }
}

export function listPeerPins(): Record<string, PeerPin> {
  return readAll();
}

export function getPeerPin(
  scope: IdentityScope,
  memberId: string,
): PeerPin | null {
  return readAll()[pinKey(scope, memberId)] ?? null;
}

/**
 * Record what this member's keys are, from here on.
 *
 * Called on a `first` decision, and on a `changed` one only after somebody has
 * said to. Nothing calls it on `changed` by itself, which is the whole point.
 */
export function pinPeerKey(
  scope: IdentityScope,
  memberId: string,
  verified: VerifiedDmKeyBinding,
  now = Date.now(),
): PeerPin {
  const pins = readAll();
  const key = pinKey(scope, memberId);
  const existing = pins[key];

  const pin: PeerPin = {
    thumbprint: verified.identityThumbprint,
    dmPublicKey: base64Url(verified.dmPublicKey),
    // Kept across a deliberate re-pin, so "known since" stays true to when this
    // person was first seen rather than to when they last changed devices.
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
  };

  pins[key] = pin;
  writeAll(pins);
  return pin;
}

/** Forget one, which is what accepting a change amounts to before re-pinning. */
export function forgetPeerPin(scope: IdentityScope, memberId: string): void {
  const pins = readAll();
  delete pins[pinKey(scope, memberId)];
  writeAll(pins);
}

/** Forget everybody on one server, for a server being left. */
export function forgetPeerPinsForScope(scope: IdentityScope): void {
  const pins = readAll();
  const prefix = `${scope} `;
  for (const key of Object.keys(pins)) {
    if (key.startsWith(prefix)) delete pins[key];
  }
  writeAll(pins);
}

/**
 * What to do about the binding this member list carried.
 *
 * Decides and returns. Nothing is written here, including on `first` — the same
 * evaluation runs on every member list, and a function that pinned as a side
 * effect would make `first` mean "since the last render".
 */
export async function evaluatePeerKey({
  scope,
  memberId,
  binding,
}: {
  scope: IdentityScope;
  memberId: string;
  /** Straight off the member list. Null when they have published nothing. */
  binding: string | null | undefined;
}): Promise<PeerKeyDecision> {
  if (!binding) return { kind: "none" };

  let verified: VerifiedDmKeyBinding;
  try {
    verified = await verifyDmKeyBinding(binding, scope);
  } catch (error) {
    return {
      kind: "unusable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  const pin = getPeerPin(scope, memberId);
  if (!pin) return { kind: "first", verified };

  const changedIdentity = pin.thumbprint !== verified.identityThumbprint;
  const changedKey = pin.dmPublicKey !== base64Url(verified.dmPublicKey);

  if (changedIdentity || changedKey) {
    return { kind: "changed", pin, verified, changedIdentity, changedKey };
  }

  return { kind: "known", verified, pin };
}
