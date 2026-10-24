import { base64Url, comparisonCode, verifyDmKeyBinding } from "@gryt/crypto";
import { useSyncExternalStore } from "react";

import { identityScopeFor } from "@/common";

/** Another device of yours asking this one to hand a server over to its key (GRYT-1886). */
export interface HandoverRequest {
  host: string;
  binding: string;
  deviceName: string;
  askerId: string;
  /** The same short code the asking device shows, so you know it's the one in front of you. */
  code: string;
}

/** Eight digits both screens show: from the account's current binding and the new one. */
export async function handoverCode(host: string, accountBinding: string, newBinding: string): Promise<string> {
  const scope = identityScopeFor(host);
  const side = async (binding: string) => {
    const v = await verifyDmKeyBinding(binding, scope);
    return { thumbprint: v.identityThumbprint, dmPublicKey: base64Url(v.dmPublicKey) };
  };
  const digits = comparisonCode(await side(accountBinding), await side(newBinding));
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)}`;
}

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const listener of listeners) listener();
    },
    use: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => value,
      ),
  };
}

/** Requests this device has been asked to approve, newest last. */
export const handoverRequests = store<readonly HandoverRequest[]>([]);

/** Per server, what this device's own request is doing: the code it shows, or that it was turned down. */
export const ownHandover = store<Readonly<Record<string, { code: string; denied: boolean }>>>({});

/** Per server, a pending key reset: when it takes over, and whether this device holds the key it replaces. */
export const keyResets = store<Readonly<Record<string, { at: number; holdsCurrentKey: boolean }>>>({});
