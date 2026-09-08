/**
 * Where this client keeps the people it has pinned. The deciding is in
 * `@gryt/crypto`, which does not know what storage is; this is the half that does.
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
 * Reads and writes swallow their errors. An unreadable store is not no pins, but
 * an empty map makes every peer read as `first` — the swap this refuses.
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
