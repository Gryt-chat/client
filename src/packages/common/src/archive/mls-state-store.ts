import { base64Url, base64UrlDecode } from "@gryt/crypto";

import { openBytes, sealBytes, type SealedBytes } from "../auth/archive-key.ts";
import { committed, MLS_STORE, request } from "./archive-db.ts";
import type {
  MlsDeviceRecord,
  MlsGroupRecord,
  MlsKeyPackageRecord,
  MlsStateStore,
} from "./mls-state-types.ts";

type Kind = "device" | "keyPackage" | "group";
type RecordKey = [scope: string, kind: Kind, id: string];

/** Plain rows lean on structured clone for the bytes; sealed ones go through JSON first. */
interface StoredValue {
  plain?: unknown;
  sealed?: SealedBytes;
}

const BYTES = "$bytes";

function encode(value: unknown): Uint8Array {
  const json = JSON.stringify(value, (_k, v: unknown) => (v instanceof Uint8Array ? { [BYTES]: base64Url(v) } : v));
  return new TextEncoder().encode(json);
}

function decode<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(bytes), (_k, v: unknown) =>
    v && typeof v === "object" && typeof (v as Record<string, unknown>)[BYTES] === "string"
      ? base64UrlDecode((v as Record<string, string>)[BYTES])
      : v,
  ) as T;
}

function context(key: RecordKey): string {
  return `mls:${JSON.stringify(key)}`;
}

/**
 * The driver's state for one server, in the archive database. Pass the tab's worker
 * claim as `writer` and a write from any other tab throws instead of corrupting a group.
 */
export class IndexedDbMlsStateStore implements MlsStateStore {
  private readonly db: IDBDatabase;
  private readonly key: CryptoKey | null;
  private readonly scope: string;
  private readonly writer: { readonly held: boolean } | null;

  constructor(db: IDBDatabase, key: CryptoKey | null, scope: string, writer?: { readonly held: boolean }) {
    this.db = db;
    this.key = key;
    this.scope = scope;
    this.writer = writer ?? null;
  }

  loadDevice(): Promise<MlsDeviceRecord | null> {
    return this.read(this.keyFor("device", ""));
  }

  saveDevice(device: MlsDeviceRecord): Promise<void> {
    return this.write([[this.keyFor("device", ""), device]]);
  }

  putKeyPackages(records: MlsKeyPackageRecord[]): Promise<void> {
    return this.write(records.map((r) => [this.keyFor("keyPackage", r.ref), r]));
  }

  getKeyPackage(ref: string): Promise<MlsKeyPackageRecord | null> {
    return this.read(this.keyFor("keyPackage", ref));
  }

  deleteKeyPackage(ref: string): Promise<void> {
    return this.remove(this.keyFor("keyPackage", ref));
  }

  loadGroup(conversationId: string): Promise<MlsGroupRecord | null> {
    return this.read(this.keyFor("group", conversationId));
  }

  async listGroups(): Promise<MlsGroupRecord[]> {
    const range = IDBKeyRange.bound([this.scope, "group"], [this.scope, "group", []]);
    const tx = this.db.transaction(MLS_STORE, "readonly");
    const store = tx.objectStore(MLS_STORE);
    const [keys, values] = await Promise.all([
      request(store.getAllKeys(range)),
      request(store.getAll(range) as IDBRequest<StoredValue[]>),
    ]);
    return Promise.all(values.map((v, i) => this.open<MlsGroupRecord>(keys[i] as RecordKey, v)));
  }

  /** `state` and `cursor` sit in one record, so they can't be written apart. */
  saveGroup(record: MlsGroupRecord): Promise<void> {
    return this.write([[this.keyFor("group", record.conversationId), record]]);
  }

  deleteGroup(conversationId: string): Promise<void> {
    return this.remove(this.keyFor("group", conversationId));
  }

  private keyFor(kind: Kind, id: string): RecordKey {
    return [this.scope, kind, id];
  }

  private assertWriter(): void {
    if (this.writer && !this.writer.held) {
      throw new Error("Only the tab holding the MLS worker lock may change MLS state");
    }
  }

  private async read<T>(key: RecordKey): Promise<T | null> {
    const tx = this.db.transaction(MLS_STORE, "readonly");
    const value = await request<StoredValue | undefined>(tx.objectStore(MLS_STORE).get(key));
    return value ? this.open<T>(key, value) : null;
  }

  private async write(entries: [RecordKey, unknown][]): Promise<void> {
    this.assertWriter();
    if (entries.length === 0) return;
    const rows = await Promise.all(entries.map(async ([key, value]) => [key, await this.seal(key, value)] as const));

    const tx = this.db.transaction(MLS_STORE, "readwrite");
    const store = tx.objectStore(MLS_STORE);
    for (const [key, row] of rows) store.put(row, key);
    await committed(tx);
  }

  private async remove(key: RecordKey): Promise<void> {
    this.assertWriter();
    const tx = this.db.transaction(MLS_STORE, "readwrite");
    tx.objectStore(MLS_STORE).delete(key);
    await committed(tx);
  }

  private async seal(key: RecordKey, value: unknown): Promise<StoredValue> {
    if (!this.key) return { plain: value };
    return { sealed: await sealBytes(this.key, context(key), encode(value)) };
  }

  /** Throws on a record that won't open: guessing at MLS state forks the group. */
  private async open<T>(key: RecordKey, value: StoredValue): Promise<T> {
    if (value.plain !== undefined) return value.plain as T;
    if (!value.sealed || !this.key) throw new Error(`MLS state for ${key[1]} ${key[2]} can't be opened here`);
    return decode<T>(await openBytes(this.key, context(key), value.sealed));
  }
}
