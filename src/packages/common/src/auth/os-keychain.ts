import { getElectronAPI } from "../../../../lib/electron";
import type { Keychain } from "./archive-key.ts";

/**
 * The Electron keychain bridge, or null in a browser. Unsealing is offered even when
 * sealing isn't, so a key written earlier still opens when the keyring is locked.
 */
export async function osKeychain(): Promise<Keychain | null> {
  const api = getElectronAPI();
  if (!api?.unsealSecret || !api.sealSecret) return null;

  let canSeal = false;
  try {
    canSeal = await api.secretsAvailable();
  } catch {
    canSeal = false;
  }
  return {
    canSeal,
    seal: (plain) => api.sealSecret(plain),
    unseal: (sealed) => api.unsealSecret(sealed),
  };
}
