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
/** Each server's MLS device id in the clear, so it can still be removed once the key is gone. */
const DEVICE_NOTE = "mls-device:";
/** Devices whose state was wiped, still to be removed from their servers. Survives a wipe. */
const RETIRED_SLOT = "retired-mls-devices";

export interface RetiredMlsDevice {
  scope: string;
  deviceId: string;
}

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
      const meta = tx.objectStore(META_STORE);
      const retired = await retiredIn(meta);
      for (const name of stores) tx.objectStore(name).clear();
      if (retired.length) meta.put(retired, RETIRED_SLOT);
      await committed(tx);
    },
  };
}

/** The old retired list plus every noted device, which a wipe is about to orphan. */
async function retiredIn(meta: IDBObjectStore): Promise<RetiredMlsDevice[]> {
  const notes = IDBKeyRange.bound(DEVICE_NOTE, DEVICE_NOTE + "\uffff");
  const [keys, ids, earlier] = await Promise.all([
    request(meta.getAllKeys(notes)),
    request(meta.getAll(notes) as IDBRequest<unknown[]>),
    request(meta.get(RETIRED_SLOT) as IDBRequest<RetiredMlsDevice[] | undefined>),
  ]);
  const out = [...(earlier ?? [])];
  keys.forEach((key, i) => {
    const scope = String(key).slice(DEVICE_NOTE.length);
    const deviceId = ids[i];
    if (typeof deviceId !== "string") return;
    if (!out.some((d) => d.scope === scope && d.deviceId === deviceId)) out.push({ scope, deviceId });
  });
  return out;
}

/**
 * One server's messages and MLS state, and its device note, which isn't retired: the server
 * already removed that device (GRYT-1555). Other servers are left alone.
 */
export async function wipeServer(db: IDBDatabase, scope: string): Promise<void> {
  const tx = db.transaction([META_STORE, MESSAGE_STORE, MLS_STORE], "readwrite");
  const range = IDBKeyRange.bound([scope], [scope, []]);
  tx.objectStore(MESSAGE_STORE).delete(range);
  tx.objectStore(MLS_STORE).delete(range);
  tx.objectStore(META_STORE).delete(DEVICE_NOTE + scope);
  await committed(tx);
}

/** Written next to the sealed device record. The id isn't secret: the server hands it out. */
export async function noteMlsDevice(db: IDBDatabase, scope: string, deviceId: string): Promise<void> {
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put(deviceId, DEVICE_NOTE + scope);
  await committed(tx);
}

export async function retiredMlsDevices(db: IDBDatabase, scope: string): Promise<string[]> {
  const tx = db.transaction(META_STORE, "readonly");
  const all = (await request(tx.objectStore(META_STORE).get(RETIRED_SLOT))) as RetiredMlsDevice[] | undefined;
  return (all ?? []).filter((d) => d.scope === scope).map((d) => d.deviceId);
}

/** Once the server has removed it, or said it never had it. */
export async function forgetRetiredMlsDevice(db: IDBDatabase, scope: string, deviceId: string): Promise<void> {
  const tx = db.transaction(META_STORE, "readwrite");
  const meta = tx.objectStore(META_STORE);
  const all = ((await request(meta.get(RETIRED_SLOT))) as RetiredMlsDevice[] | undefined) ?? [];
  const left = all.filter((d) => d.scope !== scope || d.deviceId !== deviceId);
  if (left.length) meta.put(left, RETIRED_SLOT);
  else meta.delete(RETIRED_SLOT);
  await committed(tx);
}
