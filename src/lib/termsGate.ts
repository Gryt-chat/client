import { createTermsGate, TERMS_STORAGE_KEY } from "@gryt/core";
import { useSyncExternalStore } from "react";

/* Looked up on every call rather than bound once: in Electron, globalStorage patches
   setItem after this module loads, and that patch is what keeps the answer. */
export const termsGate = createTermsGate({
  read: () => localStorage.getItem(TERMS_STORAGE_KEY),
  write: (value) => localStorage.setItem(TERMS_STORAGE_KEY, value),
});

export function useAskingToAgree(): boolean {
  return useSyncExternalStore(termsGate.subscribe, termsGate.asking, termsGate.asking);
}
