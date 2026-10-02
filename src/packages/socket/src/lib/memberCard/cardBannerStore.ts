import { type CardStyle, cardStyleForWire } from "./cardStyle";

const DB_NAME = "gryt";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const PREFIX = "member-card-banner:v1:";

interface StoredBanner {
  blob: Blob | null;
  name: string | null;
  type: string | null;
}

export interface CardBannerResult {
  found: boolean;
  file: File | null;
}

const keyFor = (style: CardStyle) => `${PREFIX}${JSON.stringify(cardStyleForWire(style))}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open banner storage"));
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const finish = (value: T) => resolve(value);
    const fail = (error: unknown) => reject(error instanceof Error ? error : new Error("Banner storage failed"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => fail(transaction.error);
    run(transaction.objectStore(STORE_NAME), finish, fail);
  });
}

export async function getCardBanner(style: CardStyle): Promise<CardBannerResult> {
  return transact("readonly", (store, finish, fail) => {
    const request = store.get(keyFor(style));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      const stored = request.result as StoredBanner | undefined;
      if (!stored) return finish({ found: false, file: null });
      const file = stored.blob
        ? new File([stored.blob], stored.name ?? "banner", { type: stored.type ?? stored.blob.type })
        : null;
      finish({ found: true, file });
    };
  });
}

export async function setCardBanner(style: CardStyle, file: File | null): Promise<void> {
  return transact("readwrite", (store, finish, fail) => {
    const stored: StoredBanner = { blob: file, name: file?.name ?? null, type: file?.type ?? null };
    const request = store.put(stored, keyFor(style));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => finish();
  });
}

export async function deleteCardBanner(style: CardStyle): Promise<void> {
  return transact("readwrite", (store, finish, fail) => {
    const request = store.delete(keyFor(style));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => finish();
  });
}

export async function pruneCardBanners(styles: readonly CardStyle[]): Promise<void> {
  const keep = new Set(styles.map(keyFor));
  return transact("readwrite", (store, finish, fail) => {
    const request = store.getAllKeys(IDBKeyRange.bound(PREFIX, `${PREFIX}\uffff`));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      for (const key of request.result) if (typeof key === "string" && !keep.has(key)) store.delete(key);
      finish();
    };
  });
}
