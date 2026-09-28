import { ArchiveKeyError, type ArchiveKeyErrorCode, type Keychain, loadArchiveKey } from "../auth/archive-key.ts";
import { archiveKeySlot, forgetRetiredMlsDevice, retiredMlsDevices } from "./archive-db.ts";
import { MessageArchive } from "./message-archive.ts";
import { IndexedDbMlsStateStore } from "./mls-state-store.ts";

/**
 * Opening, retrying and clearing the local archive, with the Electron and browser
 * pieces passed in so the whole path runs under fake-indexeddb in a test.
 */

export interface LocalArchive {
  messages: MessageArchive;
  /** "browser" means history is gone if the browser clears this site's data. */
  home: "browser" | "app";
  /** Records are encrypted with a key the OS keychain holds. False on the web. */
  sealed: boolean;
  /** Sealed history was found with its key gone from storage, and it was cleared. */
  lostHistory: boolean;
  /** One per server. Pass the worker claim so only the tab holding the lock writes. */
  mlsState(scope: string, writer?: { readonly held: boolean }): IndexedDbMlsStateStore;
  /** MLS devices whose state was wiped here, still to be removed from that server. */
  retiredMlsDevices(scope: string): Promise<string[]>;
  forgetRetiredMlsDevice(scope: string, deviceId: string): Promise<void>;
}

export type LocalArchiveStatus =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "open"; home: "browser" | "app"; sealed: boolean }
  /** Nothing was deleted. `code` is null for a failure that isn't about the key. */
  | { kind: "failed"; code: ArchiveKeyErrorCode | null; message: string };

export interface LocalArchiveSnapshot {
  status: LocalArchiveStatus;
  /** Goes up each time the archive is cleared, here or in another tab. Anything holding the old one reopens. */
  epoch: number;
}

/** What the other tabs hear after a clear. */
interface ClearedMessage {
  archiveCleared: true;
}

export interface ArchiveOpenerOptions {
  openDb: () => Promise<IDBDatabase>;
  keychain: () => Promise<Keychain | null>;
  home: "browser" | "app";
  channel?: Pick<BroadcastChannel, "postMessage" | "addEventListener"> | null;
}

export interface ArchiveOpener {
  /** Opened once. A failure isn't cached, so calling again tries again: that's the retry. */
  open(): Promise<LocalArchive>;
  /** Deletes messages, MLS state, the key and its check, then opens a fresh archive. */
  clear(): Promise<LocalArchive>;
  snapshot(): LocalArchiveSnapshot;
  subscribe(listener: () => void): () => void;
}

function failure(e: unknown): LocalArchiveStatus {
  const message = e instanceof Error ? e.message : String(e);
  return { kind: "failed", code: e instanceof ArchiveKeyError ? e.code : null, message };
}

export function createArchiveOpener({ openDb, keychain, home, channel }: ArchiveOpenerOptions): ArchiveOpener {
  let opening: Promise<LocalArchive> | null = null;
  let snapshot: LocalArchiveSnapshot = { status: { kind: "idle" }, epoch: 0 };
  const listeners = new Set<() => void>();

  const set = (status: LocalArchiveStatus, bumpEpoch = false) => {
    snapshot = { status, epoch: snapshot.epoch + (bumpEpoch ? 1 : 0) };
    for (const listener of listeners) listener();
  };

  async function openOnce(): Promise<LocalArchive> {
    const db = await openDb();
    try {
      const { key, lostHistory } = await loadArchiveKey(archiveKeySlot(db), await keychain());
      return {
        messages: new MessageArchive(db, key),
        home,
        sealed: key !== null,
        lostHistory,
        mlsState: (scope, writer) => new IndexedDbMlsStateStore(db, key, scope, writer),
        retiredMlsDevices: (scope) => retiredMlsDevices(db, scope),
        forgetRetiredMlsDevice: (scope, deviceId) => forgetRetiredMlsDevice(db, scope, deviceId),
      };
    } catch (e) {
      db.close();
      throw e;
    }
  }

  function open(): Promise<LocalArchive> {
    if (opening) return opening;
    // A retry keeps showing the failure until it has an answer, so the notice doesn't flicker.
    if (snapshot.status.kind !== "failed") set({ kind: "opening" });
    const attempt: Promise<LocalArchive> = openOnce().then(
      (archive) => {
        if (opening === attempt) set({ kind: "open", home, sealed: archive.sealed });
        return archive;
      },
      (e: unknown) => {
        if (opening === attempt) {
          opening = null;
          set(failure(e));
        }
        throw e;
      },
    );
    opening = attempt;
    return attempt;
  }

  /** Drops this tab's archive so the next open reads the database again. */
  async function forget(): Promise<void> {
    const previous = opening;
    opening = null;
    const archive = await previous?.catch(() => null);
    archive?.messages.close();
  }

  async function clear(): Promise<LocalArchive> {
    // One still opening finishes first, so a key it makes can't land after the wipe.
    await opening?.catch(() => undefined);
    await forget();
    const db = await openDb();
    try {
      await archiveKeySlot(db).wipe();
    } finally {
      db.close();
    }
    set({ kind: "idle" }, true);
    channel?.postMessage({ archiveCleared: true } satisfies ClearedMessage);
    return open();
  }

  channel?.addEventListener("message", (event: MessageEvent<ClearedMessage>) => {
    if (!event.data?.archiveCleared) return;
    void forget().then(() => {
      set({ kind: "idle" }, true);
      return open().catch(() => undefined);
    });
  });

  return {
    open,
    clear,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
