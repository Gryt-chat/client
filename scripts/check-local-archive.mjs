/* eslint-env node */

// The local archive MLS history lives in: messages, the driver's state, the store key
// and the one-tab lock, against a real IndexedDB implementation (GRYT-1513).

import "fake-indexeddb/auto";

import assert from "node:assert/strict";

const { claimMlsWorker } = await import("../src/packages/common/src/archive/archive-lock.ts");
const { archiveKeySlot, openArchiveDb, MESSAGE_STORE, MLS_STORE } = await import(
  "../src/packages/common/src/archive/archive-db.ts"
);
const { MessageArchive } = await import("../src/packages/common/src/archive/message-archive.ts");
const { IndexedDbMlsStateStore } = await import("../src/packages/common/src/archive/mls-state-store.ts");
const { loadArchiveKey } = await import("../src/packages/common/src/auth/archive-key.ts");

const keyFor = async (db, kc) => (await loadArchiveKey(archiveKeySlot(db), kc)).key;

let dbCount = 0;
const freshDb = () => openArchiveDb(indexedDB, `archive-test-${++dbCount}`);

/** A keychain that only this test can open. */
const keychain = {
  canSeal: true,
  seal: async (plain) => `kc1.${Buffer.from(plain).toString("base64")}`,
  unseal: async (sealed) => {
    if (!sealed.startsWith("kc1.")) throw new Error("not ours");
    return Buffer.from(sealed.slice(4), "base64").toString();
  },
};
// After a reset the keychain still works, but only for what it sealed since.
const resetKeychain = {
  canSeal: true,
  seal: async (plain) => `kc2.${Buffer.from(plain).toString("base64")}`,
  unseal: async (sealed) => {
    if (!sealed.startsWith("kc2.")) throw new Error("keychain reset");
    return Buffer.from(sealed.slice(4), "base64").toString();
  },
};
const noKeyring = { ...keychain, canSeal: false };

const msg = (over) => ({
  scope: "srv:a",
  conversationId: "c1",
  senderId: "u1",
  text: "hello",
  attachments: {},
  ...over,
});

async function rawRows(db, storeName) {
  const tx = db.transaction(storeName, "readonly");
  return new Promise((resolve) => {
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
  });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

/* ── messages ─────────────────────────────────────────────────────────── */

test("a web archive has no key and keeps records in the clear", async () => {
  const db = await freshDb();
  assert.deepEqual(await loadArchiveKey(archiveKeySlot(db), null), { key: null, lostHistory: false });
  assert.equal(await keyFor(db, noKeyring), null, "no keyring behaves like the web");

  const archive = new MessageArchive(db, null);
  assert.equal(archive.sealed, false);
  await archive.put([msg({ messageId: "m1", sentAt: 1 })]);
  const [row] = await rawRows(db, MESSAGE_STORE);
  assert.equal(row.plain.text, "hello");
  archive.close();
});

test("pages run newest to oldest, each page oldest first", async () => {
  const db = await freshDb();
  const archive = new MessageArchive(db, null);
  const all = Array.from({ length: 7 }, (_, i) => msg({ messageId: `m${i}`, sentAt: 1000 + i, text: `t${i}` }));
  await archive.put([...all].reverse());
  // Same millisecond: messageId breaks the tie, so the order is still stable.
  await archive.put([msg({ messageId: "m6b", sentAt: 1006, text: "t6b" })]);

  const first = await archive.page("srv:a", "c1", { limit: 3 });
  assert.deepEqual(first.map((m) => m.messageId), ["m5", "m6", "m6b"]);
  const second = await archive.page("srv:a", "c1", { limit: 3, before: first[0] });
  assert.deepEqual(second.map((m) => m.messageId), ["m2", "m3", "m4"]);
  const last = await archive.page("srv:a", "c1", { limit: 3, before: second[0] });
  assert.deepEqual(last.map((m) => m.messageId), ["m0", "m1"]);
  assert.deepEqual(await archive.page("srv:a", "c1", { before: last[0] }), []);
  archive.close();
});

test("conversations and servers don't leak into each other", async () => {
  const db = await freshDb();
  const archive = new MessageArchive(db, null);
  await archive.put([
    msg({ messageId: "m1", sentAt: 1 }),
    msg({ conversationId: "c10", messageId: "m1", sentAt: 2 }),
    msg({ scope: "srv:b", messageId: "m1", sentAt: 3, text: "other server" }),
  ]);
  assert.equal((await archive.page("srv:a", "c1")).length, 1);
  assert.equal((await archive.get("srv:b", "c1", "m1")).text, "other server");

  await archive.removeConversation("srv:a", "c1");
  assert.deepEqual(await archive.page("srv:a", "c1"), []);
  assert.equal((await archive.page("srv:a", "c10")).length, 1, "c10 survives removing c1");
  assert.equal((await archive.page("srv:b", "c1")).length, 1, "the other server survives");
  archive.close();
});

test("an edit replaces the record, a delete removes it", async () => {
  const db = await freshDb();
  const archive = new MessageArchive(db, null);
  await archive.put([msg({ messageId: "m1", sentAt: 5 })]);
  await archive.put([msg({ messageId: "m1", sentAt: 5, text: "edited", editedAt: 9, senderDeviceId: "d1" })]);
  const got = await archive.get("srv:a", "c1", "m1");
  assert.equal(got.text, "edited");
  assert.equal(got.editedAt, 9);
  assert.equal(got.senderDeviceId, "d1");
  assert.equal((await archive.page("srv:a", "c1")).length, 1);

  await archive.remove("srv:a", "c1", "m1");
  assert.equal(await archive.get("srv:a", "c1", "m1"), null);
  archive.close();
});

/* ── the store key ────────────────────────────────────────────────────── */

test("with a keychain, records on disk hold no plaintext and reopen with the same key", async () => {
  const db = await freshDb();
  const key = await keyFor(db, keychain);
  assert.ok(key);
  const archive = new MessageArchive(db, key);
  assert.equal(archive.sealed, true);
  await archive.put([msg({ messageId: "m1", sentAt: 1, text: "a secret", attachments: { f: { k: "x" } } })]);

  const [row] = await rawRows(db, MESSAGE_STORE);
  assert.equal(row.plain, undefined);
  assert.ok(!Buffer.from(row.sealed.ct).toString("latin1").includes("a secret"));

  const again = new MessageArchive(db, await keyFor(db, keychain));
  const got = await again.get("srv:a", "c1", "m1");
  assert.equal(got.text, "a secret");
  assert.deepEqual(got.attachments, { f: { k: "x" } });
  archive.close();
  again.close();
});

async function sealedArchiveWithHistory() {
  const db = await freshDb();
  const archive = new MessageArchive(db, await keyFor(db, keychain));
  await archive.put([msg({ messageId: "m1", sentAt: 1 })]);
  const mls = new IndexedDbMlsStateStore(db, await keyFor(db, keychain), "srv:a");
  await mls.saveGroup(group("c1"));
  archive.close();
  return { db, before: await archiveKeySlot(db).read() };
}

async function untouched(db, before) {
  assert.deepEqual(await archiveKeySlot(db).read(), before, "the key and check are untouched");
  assert.equal((await rawRows(db, MESSAGE_STORE)).length, 1);
  assert.equal((await rawRows(db, MLS_STORE)).length, 1);
}

async function deleteMeta(db, ...names) {
  const tx = db.transaction("meta", "readwrite");
  for (const name of names) tx.objectStore("meta").delete(name);
  await new Promise((resolve) => (tx.oncomplete = resolve));
}

const code = (expected) => (e) => e.name === "ArchiveKeyError" && e.code === expected;

test("a key that's there but won't unseal throws and deletes nothing, even when canSeal is true", async () => {
  // Deny on the macOS prompt and a reset keychain both look like this: sealing works, unsealing ours doesn't.
  const { db, before } = await sealedArchiveWithHistory();
  await assert.rejects(loadArchiveKey(archiveKeySlot(db), resetKeychain), code("unseal-failed"));
  await untouched(db, before);
  await assert.rejects(loadArchiveKey(archiveKeySlot(db), { ...resetKeychain, canSeal: false }), code("unseal-failed"));
  await untouched(db, before);
});

test("a missing bridge or the wrong key throws and deletes nothing", async () => {
  const { db, before } = await sealedArchiveWithHistory();
  await assert.rejects(loadArchiveKey(archiveKeySlot(db), null), code("no-keychain"));
  await untouched(db, before);

  // A key that opens but isn't the one this archive was written with.
  const other = await freshDb();
  await keyFor(other, keychain);
  const { key: otherKey } = await archiveKeySlot(other).read();
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(otherKey, "archive-key");
  await new Promise((resolve) => (tx.oncomplete = resolve));
  await assert.rejects(loadArchiveKey(archiveKeySlot(db), keychain), code("mismatch"));
  await untouched(db, { ...before, key: otherKey });
});

test("a key that's gone while its check is still there clears the archive and says so", async () => {
  const { db, before } = await sealedArchiveWithHistory();
  await deleteMeta(db, "archive-key");
  const loaded = await loadArchiveKey(archiveKeySlot(db), keychain);
  assert.equal(loaded.lostHistory, true);
  assert.ok(loaded.key, "a fresh key replaces the lost one");
  assert.notDeepEqual((await archiveKeySlot(db).read()).key, before.key);
  assert.deepEqual(await rawRows(db, MESSAGE_STORE), []);
  assert.deepEqual(await rawRows(db, MLS_STORE), []);

  const archive = new MessageArchive(db, loaded.key);
  await archive.put([msg({ messageId: "m2", sentAt: 2, text: "after" })]);
  assert.equal((await archive.get("srv:a", "c1", "m2")).text, "after");
  archive.close();
  assert.equal((await loadArchiveKey(archiveKeySlot(db), keychain)).lostHistory, false, "only once");
});

test("a key and check that are both gone, with sealed records left, clear the archive", async () => {
  const { db } = await sealedArchiveWithHistory();
  await deleteMeta(db, "archive-key", "key-check");
  const loaded = await loadArchiveKey(archiveKeySlot(db), keychain);
  assert.equal(loaded.lostHistory, true);
  assert.deepEqual(await rawRows(db, MESSAGE_STORE), []);
  assert.deepEqual(await rawRows(db, MLS_STORE), []);
});

test("plain records with no key aren't lost history", async () => {
  const db = await freshDb();
  const plain = new MessageArchive(db, null);
  await plain.put([msg({ messageId: "m1", sentAt: 1 })]);
  plain.close();
  assert.equal((await loadArchiveKey(archiveKeySlot(db), keychain)).lostHistory, false);
  assert.equal((await rawRows(db, MESSAGE_STORE)).length, 1);
});

test("a locked keyring still gets asked to unseal a key it made earlier", async () => {
  const { db } = await sealedArchiveWithHistory();
  const loaded = await loadArchiveKey(archiveKeySlot(db), noKeyring);
  assert.equal(loaded.lostHistory, false);
  const archive = new MessageArchive(db, loaded.key);
  assert.equal((await archive.get("srv:a", "c1", "m1")).text, "hello");
  archive.close();
});

test("a window that loses the race to make the key uses the winner's", async () => {
  const db = await freshDb();
  const k1 = await keyFor(db, keychain);
  // The second window read an empty slot just before the first one filled it.
  const slot = archiveKeySlot(db);
  let stale = true;
  const empty = { key: undefined, check: undefined, sealedRecords: false };
  const racing = { ...slot, read: () => (stale ? ((stale = false), Promise.resolve(empty)) : slot.read()) };
  const loaded = await loadArchiveKey(racing, keychain);
  assert.equal(loaded.lostHistory, false, "losing the race isn't losing history");
  const k2 = loaded.key;
  const a = new MessageArchive(db, k1);
  const b = new MessageArchive(db, k2);
  await a.put([msg({ messageId: "m1", sentAt: 1, text: "from a" })]);
  assert.equal((await b.get("srv:a", "c1", "m1")).text, "from a");
  a.close();
  b.close();
});

test("a sealed record moved under another id doesn't open", async () => {
  const db = await freshDb();
  const archive = new MessageArchive(db, await keyFor(db, keychain));
  await archive.put([msg({ messageId: "m1", sentAt: 1 })]);
  const [row] = await rawRows(db, MESSAGE_STORE);

  const tx = db.transaction(MESSAGE_STORE, "readwrite");
  tx.objectStore(MESSAGE_STORE).put({ ...row, conversationId: "c2" });
  await new Promise((resolve) => (tx.oncomplete = resolve));

  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await archive.get("srv:a", "c2", "m1"), null);
    assert.deepEqual(await archive.page("srv:a", "c2"), []);
  } finally {
    console.warn = warn;
  }
  assert.equal((await archive.get("srv:a", "c1", "m1")).text, "hello", "the original still opens");
  archive.close();
});

test("records written before the keychain was there stay readable after", async () => {
  const db = await freshDb();
  const plain = new MessageArchive(db, await keyFor(db, noKeyring));
  await plain.put([msg({ messageId: "old", sentAt: 1, text: "before" })]);

  const sealed = new MessageArchive(db, await keyFor(db, keychain));
  await sealed.put([msg({ messageId: "new", sentAt: 2, text: "after" })]);
  assert.deepEqual((await sealed.page("srv:a", "c1")).map((m) => m.text), ["before", "after"]);
  plain.close();
  sealed.close();
});

test("a write in one tab reaches listeners in another", async () => {
  const db = await freshDb();
  const writer = new MessageArchive(db, null);
  const reader = new MessageArchive(db, null);
  const heard = [];
  const gotIt = new Promise((resolve) => reader.onChange((change) => (heard.push(change), resolve())));
  const own = [];
  writer.onChange((change) => own.push(change));

  await writer.put([msg({ messageId: "m1", sentAt: 1 }), msg({ messageId: "m2", sentAt: 2 })]);
  await gotIt;
  assert.deepEqual(heard, [{ scope: "srv:a", conversationId: "c1" }], "one change per conversation");
  assert.deepEqual(own, [{ scope: "srv:a", conversationId: "c1" }], "the writing tab hears itself too");
  writer.close();
  reader.close();
});

/* ── MLS state ────────────────────────────────────────────────────────── */

const bytes = (...b) => new Uint8Array(b);
const device = { deviceId: "d1", signKey: bytes(1, 2, 3), publicKey: bytes(4), certificate: bytes(5, 6) };
const group = (conversationId, cursor = 0) => ({
  conversationId,
  groupId: `g-${conversationId}`,
  state: bytes(9, 9, cursor),
  cursor,
  joinedEpoch: 1,
});

for (const sealedMode of [false, true]) {
  const label = sealedMode ? "sealed" : "plain";

  test(`MLS state round-trips every record kind (${label})`, async () => {
    const db = await freshDb();
    const key = sealedMode ? await keyFor(db, keychain) : null;
    const store = new IndexedDbMlsStateStore(db, key, "srv:a");

    assert.equal(await store.loadDevice(), null);
    await store.saveDevice(device);
    assert.deepEqual(await store.loadDevice(), device);

    const kp = { ref: "r1", keyPackage: bytes(7), privatePackage: bytes(8), lastResort: false, createdAt: 3 };
    // Records from before core 0.7.0 have no expiresAt, and it has to stay absent.
    const expiring = { ...kp, ref: "r3", expiresAt: 1_900_000_000 };
    await store.putKeyPackages([kp, { ...kp, ref: "r2", lastResort: true }, expiring]);
    assert.deepEqual(await store.getKeyPackage("r1"), kp);
    assert.equal("expiresAt" in (await store.getKeyPackage("r1")), false);
    assert.deepEqual(await store.getKeyPackage("r3"), expiring);
    assert.deepEqual((await store.listKeyPackages()).map((r) => r.ref).sort(), ["r1", "r2", "r3"]);
    await store.deleteKeyPackage("r1");
    assert.equal(await store.getKeyPackage("r1"), null);
    assert.equal((await store.getKeyPackage("r2")).lastResort, true);

    const pending = { ...group("c1", 4), pending: { commit: bytes(1), state: bytes(2) } };
    await store.saveGroup(pending);
    await store.saveGroup(group("c2", 7));
    assert.deepEqual(await store.loadGroup("c1"), pending);
    assert.deepEqual(
      (await store.listGroups()).map((g) => [g.conversationId, g.cursor]).sort(),
      [["c1", 4], ["c2", 7]],
    );
    await store.deleteGroup("c1");
    assert.equal(await store.loadGroup("c1"), null);

    if (sealedMode) {
      const raw = await rawRows(db, MLS_STORE);
      assert.ok(raw.every((r) => r.plain === undefined && r.sealed), "nothing in the clear");
    }
  });
}

test("each server gets its own MLS state", async () => {
  const db = await freshDb();
  const a = new IndexedDbMlsStateStore(db, null, "srv:a");
  const b = new IndexedDbMlsStateStore(db, null, "srv:b");
  await a.saveDevice(device);
  await a.saveGroup(group("c1"));
  await a.putKeyPackages([{ ref: "r1", keyPackage: bytes(1), privatePackage: bytes(2), lastResort: false, createdAt: 1 }]);
  assert.equal(await b.loadDevice(), null);
  assert.deepEqual(await b.listKeyPackages(), []);
  assert.deepEqual(await b.listGroups(), []);
  assert.equal(await b.loadGroup("c1"), null);
});

test("a sealed MLS record that won't open throws rather than reading as missing", async () => {
  const db = await freshDb();
  const store = new IndexedDbMlsStateStore(db, await keyFor(db, keychain), "srv:a");
  await store.saveGroup(group("c1"));
  const keyless = new IndexedDbMlsStateStore(db, null, "srv:a");
  await assert.rejects(keyless.loadGroup("c1"), /can't be opened/);
  await assert.rejects(keyless.listGroups(), /can't be opened/);
});

test("only the tab holding the worker lock writes MLS state", async () => {
  const db = await freshDb();
  const writer = { held: false };
  const store = new IndexedDbMlsStateStore(db, null, "srv:a", writer);
  await assert.rejects(store.saveDevice(device), /worker lock/);
  await assert.rejects(store.deleteGroup("c1"), /worker lock/);
  assert.equal(await store.loadDevice(), null, "reads are fine from any tab");
  writer.held = true;
  await store.saveDevice(device);
  assert.deepEqual(await store.loadDevice(), device);
});

/* ── the tab lock ─────────────────────────────────────────────────────── */

test("one tab holds the MLS worker lock and the next takes over when it lets go", async () => {
  assert.ok(globalThis.navigator?.locks, "Node 24 has Web Locks");
  const name = `mls-test-${Date.now()}`;
  const started = [];
  let secondUp;
  const secondStarted = new Promise((resolve) => (secondUp = resolve));

  let firstUp;
  const firstStarted = new Promise((resolve) => (firstUp = resolve));
  const first = claimMlsWorker({ name, onAcquire: () => (started.push("first"), firstUp()) });
  await firstStarted;
  const second = claimMlsWorker({ name, onAcquire: () => (started.push("second"), secondUp()) });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(first.held, true);
  assert.equal(second.held, false);
  assert.deepEqual(started, ["first"]);

  first.release();
  await secondStarted;
  assert.equal(first.held, false);
  assert.equal(second.held, true);
  second.release();
});

test("a tab that leaves the queue never starts", async () => {
  const name = `mls-test-queue-${Date.now()}`;
  let holderUp;
  const up = new Promise((resolve) => (holderUp = resolve));
  const holder = claimMlsWorker({ name, onAcquire: () => holderUp() });
  await up;
  let ran = false;
  const waiting = claimMlsWorker({ name, onAcquire: () => (ran = true) });
  waiting.release();
  holder.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(ran, false);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`not ok - ${name}\n`, e);
  }
}
if (failed) {
  console.error(`\n${failed} of ${tests.length} failed`);
  process.exit(1);
}
console.log(`\nall ${tests.length} passed`);
