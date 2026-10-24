import { useEffect } from "react";

import { getAccountProfile, hasMessageKeyHere, readSealedVault, useAccount, writeSealedVault } from "@/common";

/**
 * Takes the old password-locked copy of the message key off the account (GRYT-1882). Only where
 * this device has the key, so a device without it never deletes the one copy somebody relies on.
 */
export function VaultUpgradePrompt() {
  const { isSignedIn } = useAccount();

  useEffect(() => {
    if (!isSignedIn) return;
    void (async () => {
      const sub = (await getAccountProfile()).sub;
      if (!sub || !hasMessageKeyHere(sub) || !(await readSealedVault())) return;
      await writeSealedVault(null);
    })().catch((e: Error) => console.warn("[MessageKey] Couldn't remove the old copy from the account:", e));
  }, [isSignedIn]);

  return null;
}
