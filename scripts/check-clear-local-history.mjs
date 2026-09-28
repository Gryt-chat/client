/* eslint-env node */

// Clearing local history on purpose, and trying again after a keychain Deny (GRYT-1527).
// The opener runs against fake-indexeddb with the same code the app uses.

import "fake-indexeddb/auto";

import assert from "node:assert/strict";

const { archiveKeySlot, openArchiveDb, MESSAGE_STORE, MLS_STORE, META_STORE } = await import(
  "../src/packages/common/src/archive/archive-db.ts"
);
const { createArchiveOpener } = await import("../src/packages/common/src/archive/archive-opener.ts");
const { IndexedDbMlsStateStore } = await import("../src/packages/common/src/archive/mls-state-store.ts");
const { loadArchiveKey } = await import("../src/packages/common/src/auth/archive-key.ts");

/** Seals with a tag and only opens its own, like a keychain whose item was reset. */
const keychainTagged = (tag) => ({
  canSeal: true,
  seal: async (plain) => `${tag}.${Buffer.from(plain).toString("base64")}`,
  unseal: async (sealed) => {
    if (!sealed.startsWith(`${tag}.`)) throw new Error("keychain said no");
    return Buffer.from(sealed.slice(tag.length + 1), "base64").toString();
  },
});
const allowing = keychainTagged("kc1");
// Clicking Deny: sealing something new still works, opening the old key doesn't.
const denying = keychainTagged("kc2");

const bytes = (...b) => new Uint8Array(b);
const oldDevice = { deviceId: "old-device", signKey: bytes(1, 2), publicKey: bytes(3), certificate: bytes(4) };
const group = { conversationId: "c1", groupId: "g-c1", state: bytes(9), cursor: 3, joinedEpoch: 1 };
const msg = (over) => ({ scope: "srv:a", conversationId: "c1", senderId: "u1", text: "old secret", attachments: {}, ...over });

let dbCount = 0;
const freshName = () => `clear-test-${++dbCount}`;

function openerFor(name, keychain, extra = {}) {
  const current = { keychain };
  const opener = createArchiveOpener({
    openDb: () => openArchiveDb(indexedDB, name),
    keychain: async () => current.keychain,
    home: extra.home ?? "app",
    channel: extra.channel ?? null,
  });
  return { opener, use: (next) => (current.keychain = next) };
}

async function rows(name, storeName) {
  const db = await openArchiveDb(indexedDB, name);
  try {
    const tx = db.transaction(storeName, "readonly");
    return await new Promise((resolve) => {
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
    });
  } finally {
    db.close();
  }
}

async function slot(name) {
  const db = await openArchiveDb(indexedDB, name);
  try {
    return await archiveKeySlot(db).read();
  } finally {
    db.close();
  }
}

/** An archive with a message, a device and a group in it, sealed by `keychain`. */
async function archiveWithHistory(keychain = allowing) {
  const name = freshName();
  const { opener } = openerFor(name, keychain);
  const archive = await opener.open();
  await archive.messages.put([msg({ messageId: "m1", sentAt: 1 })]);
  const store = archive.mlsState("srv:a");
  await store.saveDevice(oldDevice);
  await store.saveGroup(group);
  archive.messages.close();
  return name;
}

const code = (expected) => (e) => e.name === "ArchiveKeyError" && e.code === expected;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("Try again after a Deny deletes nothing, and opens once the keychain allows it", async () => {
  const name = await archiveWithHistory();
  const before = { key: await slot(name), messages: await rows(name, MESSAGE_STORE), mls: await rows(name, MLS_STORE) };
  const { opener, use } = openerFor(name, denying);

  await assert.rejects(opener.open(), code("unseal-failed"));
  assert.deepEqual(opener.snapshot().status.kind, "failed");
  assert.equal(opener.snapshot().status.code, "unseal-failed");

  // Try again, still denied.
  await assert.rejects(opener.open(), code("unseal-failed"));
  assert.deepEqual(await slot(name), before.key, "the key and check are untouched");
  assert.deepEqual(await rows(name, MESSAGE_STORE), before.messages);
  assert.deepEqual(await rows(name, MLS_STORE), before.mls);

  use(allowing);
  const archive = await opener.open();
  assert.equal((await archive.messages.get("srv:a", "c1", "m1")).text, "old secret");
  assert.deepEqual(await archive.mlsState("srv:a").loadDevice(), oldDevice);
  assert.deepEqual(opener.snapshot(), { status: { kind: "open", home: "app", sealed: true }, epoch: 0 });
  assert.deepEqual(await archive.retiredMlsDevices("srv:a"), [], "a retry retires nothing");
  archive.messages.close();
});

test("clearing opens a fresh archive and nothing old is left to read", async () => {
  const name = await archiveWithHistory();
  const oldKey = (await slot(name)).key;
  const { opener } = openerFor(name, denying);
  await assert.rejects(opener.open(), code("unseal-failed"));

  const fresh = await opener.clear();
  assert.equal(fresh.lostHistory, false, "a clear on purpose isn't reported as lost history");
  assert.equal(fresh.sealed, true);
  assert.deepEqual(opener.snapshot(), { status: { kind: "open", home: "app", sealed: true }, epoch: 1 });

  const now = await slot(name);
  assert.notDeepEqual(now.key, oldKey, "a new key");
  assert.ok(now.key.sealed.startsWith("kc2."), "sealed by the keychain that's there now");
  assert.deepEqual(await rows(name, MESSAGE_STORE), [], "no old messages, sealed or not");
  assert.deepEqual(await rows(name, MLS_STORE), [], "no old MLS state");
  assert.equal(await fresh.messages.get("srv:a", "c1", "m1"), null);
  assert.deepEqual(await fresh.messages.page("srv:a", "c1", { limit: 50 }), []);

  const store = fresh.mlsState("srv:a");
  assert.equal(await store.loadDevice(), null, "the next start makes a new MLS device");
  assert.deepEqual(await store.listGroups(), []);
  assert.deepEqual(await fresh.retiredMlsDevices("srv:a"), ["old-device"], "the old device waits to be removed");
  assert.deepEqual(await fresh.retiredMlsDevices("srv:b"), []);

  // The fresh archive works, and reopening it in a new window gets the same key.
  await fresh.messages.put([msg({ messageId: "m2", sentAt: 2, text: "new" })]);
  const again = await openerFor(name, denying).opener.open();
  assert.equal((await again.messages.get("srv:a", "c1", "m2")).text, "new");
  fresh.messages.close();
  again.messages.close();
});

test("the old device leaves the list once the server has removed it", async () => {
  const name = await archiveWithHistory();
  const { opener } = openerFor(name, denying);
  const fresh = await opener.clear();
  await fresh.mlsState("srv:a").saveDevice({ ...oldDevice, deviceId: "new-device" });
  assert.deepEqual(await fresh.retiredMlsDevices("srv:a"), ["old-device"]);
  await fresh.forgetRetiredMlsDevice("srv:a", "old-device");
  assert.deepEqual(await fresh.retiredMlsDevices("srv:a"), []);

  // A second clear retires the new device and nothing it already forgot.
  const second = await opener.clear();
  assert.deepEqual(await second.retiredMlsDevices("srv:a"), ["new-device"]);
  fresh.messages.close();
  second.messages.close();
});

test("a device not removed yet is still listed after another clear", async () => {
  const name = await archiveWithHistory();
  const { opener } = openerFor(name, denying);
  const first = await opener.clear();
  const second = await opener.clear();
  assert.deepEqual(await second.retiredMlsDevices("srv:a"), ["old-device"]);
  first.messages.close();
  second.messages.close();
});

test("the web has no keychain and clears the same way", async () => {
  const name = freshName();
  const { opener } = openerFor(name, null, { home: "browser" });
  const archive = await opener.open();
  assert.equal(archive.sealed, false);
  await archive.messages.put([msg({ messageId: "m1", sentAt: 1 })]);
  await archive.mlsState("srv:a").saveDevice(oldDevice);

  const fresh = await opener.clear();
  assert.equal(fresh.sealed, false);
  assert.deepEqual(await rows(name, MESSAGE_STORE), []);
  assert.deepEqual(await rows(name, MLS_STORE), []);
  assert.deepEqual(await fresh.retiredMlsDevices("srv:a"), ["old-device"]);
  assert.deepEqual(opener.snapshot(), { status: { kind: "open", home: "browser", sealed: false }, epoch: 1 });
  archive.messages.close();
  fresh.messages.close();
});

test("a key gone from storage retires the device too", async () => {
  const name = await archiveWithHistory();
  const db = await openArchiveDb(indexedDB, name);
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).delete("archive-key");
  await new Promise((resolve) => (tx.oncomplete = resolve));

  const loaded = await loadArchiveKey(archiveKeySlot(db), allowing);
  assert.equal(loaded.lostHistory, true);
  const store = new IndexedDbMlsStateStore(db, loaded.key, "srv:a");
  assert.equal(await store.loadDevice(), null);
  const { retiredMlsDevices } = await import("../src/packages/common/src/archive/archive-db.ts");
  assert.deepEqual(await retiredMlsDevices(db, "srv:a"), ["old-device"]);
  db.close();
});

test("a clear in one tab makes the other tab open the fresh archive", async () => {
  const name = await archiveWithHistory();
  const channelName = `clear-test-channel-${dbCount}`;
  const a = openerFor(name, denying, { channel: new BroadcastChannel(channelName) });
  const bChannel = new BroadcastChannel(channelName);
  const b = openerFor(name, denying, { channel: bChannel });
  await assert.rejects(b.opener.open(), code("unseal-failed"));

  const reopened = new Promise((resolve) => {
    const off = b.opener.subscribe(() => {
      if (b.opener.snapshot().status.kind === "open") (off(), resolve());
    });
  });
  const fresh = await a.opener.clear();
  await reopened;
  assert.equal(b.opener.snapshot().epoch, 1);
  const other = await b.opener.open();
  await fresh.messages.put([msg({ messageId: "m3", sentAt: 3, text: "after" })]);
  assert.equal((await other.messages.get("srv:a", "c1", "m3")).text, "after", "both tabs use the one new key");
  fresh.messages.close();
  other.messages.close();
  bChannel.close();
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
process.exit(0);
