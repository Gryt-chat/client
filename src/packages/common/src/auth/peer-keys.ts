/**
 * Where this client keeps the people it has pinned (GRYT-726, GRYT-732).
 *
 * The deciding is in `@gryt/crypto`, which does not know what storage is. This
 * is the half that does: a `localStorage` store and the same functions with it
 * already supplied, so every call site in the client reads the way it did
 * before the package existed.
 *
 * Mobile writes its own eight lines against the same interface. That is the
 * only difference between the two clients on this — a phone has no
 * `localStorage`, and everything above the store is one implementation now
 * rather than two that agree until they do not.
 */

import {
  evaluatePeerKey as evaluate,
  forgetPeerPin as forget,
  forgetPeerPinsForScope as forgetScope,
  getPeerPin as get,
  type IdentityScope,
  listPeerPins as list,
  markPeerCompared as markCompared,
  PEER_PINS_KEY,
  type PeerPin,
  type PeerPinStore,
  pinPeerKey as pin,
  type VerifiedDmKeyBinding,
} from "@gryt/crypto";

export type { PeerKeyDecision, PeerPin, PeerPinStore } from "@gryt/crypto";

/**
 * Reads and writes swallow their errors, which is deliberate on both sides.
 *
 * An unreadable store is not the same as no pins, and returning an empty map
 * here makes every peer read as `first` and get re-pinned — the exact swap this
 * module exists to refuse. There is no better answer available and no way to
 * tell the two apart from in here, so it takes the same trade `server-pins.ts`
 * has taken since GRYT-51.
 *
 * A failed write loses the memory of a decision rather than the decision, which
 * has already been returned by the time this runs.
 */
export const localPeerPinStore: PeerPinStore = {
  read() {
    try {
      const raw = localStorage.getItem(PEER_PINS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  },
  write(pins) {
    try {
      localStorage.setItem(PEER_PINS_KEY, JSON.stringify(pins));
    } catch {
      // Full or blocked.
    }
  },
};

export function listPeerPins(): Record<string, PeerPin> {
  return list(localPeerPinStore);
}

export function getPeerPin(
  scope: IdentityScope,
  memberId: string,
): PeerPin | null {
  return get(localPeerPinStore, scope, memberId);
}

export function pinPeerKey(
  scope: IdentityScope,
  memberId: string,
  verified: VerifiedDmKeyBinding,
  now = Date.now(),
): PeerPin {
  return pin(localPeerPinStore, scope, memberId, verified, now);
}

export function markPeerCompared(
  scope: IdentityScope,
  memberId: string,
  keys: { thumbprint: string; dmPublicKey: string },
  now = Date.now(),
): boolean {
  return markCompared(localPeerPinStore, scope, memberId, keys, now);
}

export function forgetPeerPin(scope: IdentityScope, memberId: string): void {
  forget(localPeerPinStore, scope, memberId);
}

export function forgetPeerPinsForScope(scope: IdentityScope): void {
  forgetScope(localPeerPinStore, scope);
}

export function evaluatePeerKey(args: {
  scope: IdentityScope;
  memberId: string;
  binding: string | null | undefined;
}) {
  return evaluate({ store: localPeerPinStore, ...args });
}
