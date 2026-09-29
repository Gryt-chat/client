/* eslint-env node */

// "New device linked" (GRYT-1583): once per new device id, never for this device or one it
// linked itself, and the first look at a server only takes a baseline.

import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const { expectOwnDevice, linkedDeviceLine, linkedDeviceNotices, newOwnDevices, noteOwnDevices } = await import(
  "../src/packages/socket/src/mls/linkedDevices.ts"
);

const dev = (deviceId, extra = {}) => ({ deviceId, serverUserId: "me", name: null, addedAt: null, lastSeenAt: null, thisDevice: false, ...extra });

// The pure diff.
assert.deepEqual(newOwnDevices(undefined, [dev("a"), dev("b")]), { known: ["a", "b"], fresh: [] }, "first look is a baseline");
{
  const { known, fresh } = newOwnDevices(["a"], [dev("a"), dev("b"), dev("me", { thisDevice: true })]);
  assert.deepEqual(fresh.map((d) => d.deviceId), ["b"], "never this device");
  assert.deepEqual(known, ["a", "b", "me"]);
}
assert.deepEqual(newOwnDevices(["a", "gone"], [dev("a")]).known, ["a", "gone"], "a removed id stays known, so it can't come back as new");

// Through storage, per server.
const S = "srv:ONE";
assert.deepEqual(noteOwnDevices("one.example", S, [dev("a"), dev("me", { thisDevice: true })]), []);
const shown = noteOwnDevices("one.example", S, [dev("a"), dev("b", { name: "MacBook Air", addedAt: "2026-09-29T10:00:00Z" })]);
assert.deepEqual(shown.map((n) => [n.deviceId, n.name, n.at]), [["b", "MacBook Air", Date.parse("2026-09-29T10:00:00Z")]]);
assert.deepEqual(noteOwnDevices("one.example", S, [dev("a"), dev("b")]), [], "once per device id");
assert.deepEqual(linkedDeviceNotices.get().map((n) => n.deviceId), ["b"], "kept until dismissed");

// A device this one linked itself.
expectOwnDevice(S, "c");
assert.deepEqual(noteOwnDevices("one.example", S, [dev("a"), dev("b"), dev("c")]), []);
// No baseline yet on this server: nothing to mark, and the first look covers it.
expectOwnDevice("srv:TWO", "x");
assert.deepEqual(noteOwnDevices("two.example", "srv:TWO", [dev("x")]), []);

// Survives a reload.
const reloaded = await import(`../src/packages/socket/src/mls/linkedDevices.ts?again`);
assert.deepEqual(reloaded.linkedDeviceNotices.get().map((n) => n.deviceId), ["b"]);

linkedDeviceNotices.dismiss("b");
assert.deepEqual(linkedDeviceNotices.get(), []);

assert.equal(linkedDeviceLine({ name: "MacBook Air", at: 0 }, false), "New device linked: MacBook Air. Not you? Remove it.");
assert.equal(linkedDeviceLine({ name: null, at: 0 }, false), "New device linked. Not you? Remove it.");
assert.match(linkedDeviceLine({ name: "Pixel", at: Date.parse("2026-09-29T10:00:00Z") }, true), /^New device linked: Pixel, .+\. Not you\? Remove it\.$/);

console.log("linked devices: ok");
