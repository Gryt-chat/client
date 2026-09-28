import { isElectron } from "../../../../lib/electron";
import { loadArchiveKey } from "../auth/archive-key.ts";
import { osKeychain } from "../auth/os-keychain.ts";
import { archiveKeySlot, openArchiveDb } from "./archive-db.ts";
import { MessageArchive } from "./message-archive.ts";
import { IndexedDbMlsStateStore } from "./mls-state-store.ts";

export interface LocalArchive {
  messages: MessageArchive;
  /** "browser" means history is gone if the browser clears this site's data. */
  home: "browser" | "app";
  /** Records are encrypted with a key the OS keychain holds. False on the web. */
  sealed: boolean;
  /** One per server. Pass the worker claim so only the tab holding the lock writes. */
  mlsState(scope: string, writer?: { readonly held: boolean }): IndexedDbMlsStateStore;
}

let opening: Promise<LocalArchive> | null = null;

async function open(): Promise<LocalArchive> {
  const db = await openArchiveDb();
  const key = await loadArchiveKey(archiveKeySlot(db), await osKeychain());
  return {
    messages: new MessageArchive(db, key),
    home: isElectron() ? "app" : "browser",
    sealed: key !== null,
    mlsState: (scope, writer) => new IndexedDbMlsStateStore(db, key, scope, writer),
  };
}

/** Opened once per window. A failure isn't cached, so a later call tries again. */
export function openLocalArchive(): Promise<LocalArchive> {
  opening ??= open().catch((e: unknown) => {
    opening = null;
    throw e;
  });
  return opening;
}
