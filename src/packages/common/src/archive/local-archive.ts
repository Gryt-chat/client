import { useSyncExternalStore } from "react";

import { isElectron } from "../../../../lib/electron";
import { osKeychain } from "../auth/os-keychain.ts";
import { openArchiveDb } from "./archive-db.ts";
import { createArchiveOpener, type LocalArchive, type LocalArchiveSnapshot } from "./archive-opener.ts";

export { ArchiveKeyError, type ArchiveKeyErrorCode } from "../auth/archive-key.ts";
export type { LocalArchive, LocalArchiveSnapshot, LocalArchiveStatus } from "./archive-opener.ts";

const opener = createArchiveOpener({
  openDb: () => openArchiveDb(),
  keychain: osKeychain,
  home: isElectron() ? "app" : "browser",
  channel: typeof BroadcastChannel === "function" ? new BroadcastChannel("gryt-archive-lifecycle") : null,
});

/** Opened once per window. A failure isn't cached, so a later call tries again. */
export function openLocalArchive(): Promise<LocalArchive> {
  return opener.open();
}

/** Only on the person's say-so: what this device decrypted is gone for good. */
export function clearLocalArchive(): Promise<LocalArchive> {
  return opener.clear();
}

export const subscribeToLocalArchive = opener.subscribe;
export const getLocalArchiveSnapshot = opener.snapshot;

export function useLocalArchive(): LocalArchiveSnapshot {
  return useSyncExternalStore(opener.subscribe, opener.snapshot, opener.snapshot);
}
