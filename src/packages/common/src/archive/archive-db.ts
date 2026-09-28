import type { ArchiveKeySlot, SealedBytes, StoredArchiveKey } from "../auth/archive-key.ts";

/** One database for the message archive and the MLS state, so one key covers both. */

export const ARCHIVE_DB_NAME = "gryt_archive";
const ARCHIVE_DB_VERSION = 1;

export const META_STORE = "meta";
export const MESSAGE_STORE = "messages";
export const MESSAGE_BY_TIME = "byTime";
export const MLS_STORE = "mls";

const KEY_SLOT = "archive-key";
const CHECK_SLOT = "key-check";

export function openArchiveDb(factory: IDBFactory = indexedDB, name = ARCHIVE_DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, ARCHIVE_DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
        const messages = db.createObjectStore(MESSAGE_STORE, { keyPath: ["scope", "conversationId", "messageId"] });
        messages.createIndex(MESSAGE_BY_TIME, ["scope", "conversationId", "sentAt", "messageId"]);
      }
      if (!db.objectStoreNames.contains(MLS_STORE)) db.createObjectStore(MLS_STORE);
    };
    open.onsuccess = () => {
      // Let a newer build in another tab upgrade the schema instead of blocking it forever.
      open.result.onversionchange = () => open.result.close();
      resolve(open.result);
    };
    open.onerror = () => reject(open.error ?? new Error("Couldn't open the message archive"));
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Resolves once the transaction commits, which is when a write is actually on disk. */
export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Archive transaction aborted"));
  });
}

function anySealed(store: IDBObjectStore): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const cursor = store.openCursor();
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const at = cursor.result;
      if (!at) return resolve(false);
      if ((at.value as { sealed?: unknown }).sealed) return resolve(true);
      at.continue();
    };
  });
}

export function archiveKeySlot(db: IDBDatabase): ArchiveKeySlot {
  return {
    async read({ lookForSealed = false } = {}) {
      const tx = db.transaction([META_STORE, MESSAGE_STORE, MLS_STORE], "readonly");
      const meta = tx.objectStore(META_STORE);
      const [key, check] = await Promise.all([
        request<unknown>(meta.get(KEY_SLOT)),
        request<SealedBytes | undefined>(meta.get(CHECK_SLOT)),
      ]);
      // Only asked when the key is missing, which is a first run or the case that needs it.
      const scan = lookForSealed && key === undefined && check === undefined;
      const sealedRecords =
        scan && ((await anySealed(tx.objectStore(MESSAGE_STORE))) || (await anySealed(tx.objectStore(MLS_STORE))));
      return { key, check, sealedRecords };
    },
    async claim(value: StoredArchiveKey) {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      const existing = await request(store.getKey(KEY_SLOT));
      if (existing === undefined) store.add(value, KEY_SLOT);
      await committed(tx);
    },
    async writeCheck(check: SealedBytes) {
      const tx = db.transaction(META_STORE, "readwrite");
      tx.objectStore(META_STORE).put(check, CHECK_SLOT);
      await committed(tx);
    },
    async wipe() {
      const stores = [META_STORE, MESSAGE_STORE, MLS_STORE];
      const tx = db.transaction(stores, "readwrite");
      for (const name of stores) tx.objectStore(name).clear();
      await committed(tx);
    },
  };
}
