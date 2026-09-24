/* eslint-env node */

/**
 * Which rows the sidebar leaves out while muted channels are hidden, and that a
 * drag with some of them out still sends every row back in the right place.
 */

import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { getHideMuted, hiddenMutedRows, setHideMuted, subscribeToPrefs } = await import(
  "../src/packages/common/src/hooks/notificationPrefs.ts"
);
const { buildReorderPayload, flattenSidebar, moveAmongDrawn, restoreHiddenRows } = await import(
  "../src/packages/socket/src/components/sidebarTree.ts"
);

const HOST = "gryt.test:5001";
const folder = (id, position) => ({ id, kind: "folder", label: id, position });
const channel = (id, position, parentItemId = null) => ({
  id,
  kind: "channel",
  channelId: id,
  position,
  parentItemId,
});
const none = new Set();
const hidden = (prefs, items, keep = none, channels = []) =>
  [...hiddenMutedRows({ [HOST]: prefs }, HOST, items, channels, keep).rows].sort();

// ── What counts as muted ────────────────────────────────────────────────────

const loose = [channel("a", 10), channel("b", 20)];

// Nothing set: nothing goes.
assert.deepEqual(hidden({}, loose), []);

// Muted outright.
assert.deepEqual(hidden({ channels: { a: "none" } }, loose), ["a"]);

// "Only mentions" is still asking for something, so it stays.
assert.deepEqual(hidden({ channels: { a: "mentions" } }, loose), []);

// The whole server muted takes every channel with it.
assert.deepEqual(hidden({ server: "none" }, loose), ["a", "b"]);

// Unless a channel was turned back up on its own.
assert.deepEqual(hidden({ server: "none", channels: { b: "all" } }, loose), ["a"]);

// A channel the server sets to nothing by default, left at default, is muted.
assert.deepEqual(
  hidden({}, loose, none, [{ id: "a", defaultNotificationLevel: "none" }]),
  ["a"],
);

// ── Folders ─────────────────────────────────────────────────────────────────

const nested = [
  folder("f", 10),
  channel("f1", 10, "f"),
  channel("f2", 20, "f"),
  folder("g", 20),
  channel("g1", 10, "g"),
  folder("empty", 30),
  channel("top", 40),
];

// A muted folder takes its channels, and goes with them.
assert.deepEqual(hidden({ folders: { f: "none" } }, nested), ["f", "f1", "f2"]);

// One channel left in it keeps the folder.
assert.deepEqual(
  hidden({ folders: { f: "none" }, channels: { f2: "all" } }, nested),
  ["f1"],
);

// An empty folder is not muted, and a server-wide mute does not hide it here.
assert.ok(!hidden({ server: "none" }, nested).includes("empty"));
assert.deepEqual(hidden({ server: "none" }, nested), ["f", "f1", "f2", "g", "g1", "top"]);

// A parent that is not a real folder is the top level, and reads no folder level.
assert.deepEqual(
  hidden({ folders: { ghost: "none" } }, [channel("orphan", 10, "ghost")]),
  [],
);

// ── Never hidden ────────────────────────────────────────────────────────────

// Whatever `keep` holds stays: the open channel, a call, a mention.
assert.deepEqual(hidden({ server: "none" }, loose, new Set(["b"])), ["a"]);

// And it keeps its folder with it.
assert.deepEqual(
  hidden({ folders: { f: "none" } }, nested, new Set(["f1"])),
  ["f2"],
);

// The count is channels, not folders.
assert.equal(
  hiddenMutedRows({ [HOST]: { folders: { f: "none" } } }, HOST, nested, [], none).channels,
  2,
);

// ── The switch ──────────────────────────────────────────────────────────────

let heard = 0;
subscribeToPrefs(() => { heard += 1; });

assert.equal(getHideMuted(HOST), false);
setHideMuted(HOST, true);
assert.equal(getHideMuted(HOST), true);
assert.equal(store.get(`gryt_sidebar_hide_muted:${HOST}`), "1");
// Per server.
assert.equal(getHideMuted("other:5001"), false);
// Setting it to what it is already says nothing.
setHideMuted(HOST, true);
assert.equal(heard, 1);
setHideMuted(HOST, false);
assert.equal(store.has(`gryt_sidebar_hide_muted:${HOST}`), false);
assert.equal(heard, 2);

// ── A drag with rows hidden ─────────────────────────────────────────────────

const byId = (items) => new Map(items.map((i) => [i.id, i]));
const pick = (items, ids) => { const m = byId(items); return ids.map((id) => m.get(id)); };
const ids = (items) => items.map((i) => i.id);
/* The server numbers rows in the order sent and sorts each folder on its own, so
   what has to hold is the order within each folder and within the top level. */
const siblings = (items, moved = {}) => {
  const out = {};
  for (const i of items) {
    const parent = i.id in moved ? moved[i.id] : i.kind === "channel" ? i.parentItemId ?? "" : "";
    (out[parent] ??= []).push(i.id);
  }
  return out;
};

/* Sidebar: x, [F: f1, f2(hidden), f3], y(hidden), z. Visible order is x, F, f1, f3, z. */
const sidebar = [
  channel("x", 10),
  folder("F", 20),
  channel("f1", 10, "F"),
  channel("f2", 20, "F"),
  channel("f3", 30, "F"),
  channel("y", 30),
  channel("z", 40),
];
const before = flattenSidebar(sidebar).map((r) => r.item);
const gone = new Set(["f2", "y"]);

// Nothing moved: the order comes back exactly as it was.
assert.deepEqual(
  siblings(restoreHiddenRows(pick(sidebar, ["x", "F", "f1", "f3", "z"]), before, gone, "x")),
  siblings(before),
);

// z dragged to the top. y stays after F, where it was, rather than riding with z.
assert.deepEqual(
  siblings(restoreHiddenRows(pick(sidebar, ["z", "x", "F", "f1", "f3"]), before, gone, "z")),
  { "": ["z", "x", "F", "y"], F: ["f1", "f2", "f3"] },
);

// f1 dragged out of the folder: f2 was after it, and falls back to first in F.
{
  const order = restoreHiddenRows(pick(sidebar, ["x", "f1", "F", "f3", "z"]), before, gone, "f1");
  assert.deepEqual(siblings(order, { f1: "" }), { "": ["x", "f1", "F", "y", "z"], F: ["f2", "f3"] });
  // Every row goes to the server, each stating its folder.
  const payload = buildReorderPayload(order, sidebar, "f1", null);
  assert.deepEqual(payload.map((e) => e.itemId).sort(), ids(sidebar).sort());
  assert.deepEqual(
    Object.fromEntries(payload.map((e) => [e.itemId, e.parentItemId])),
    { x: null, f1: null, F: null, f2: "F", f3: "F", y: null, z: null },
  );
}

// A hidden folder, children and all, keeps its place when something moves past it.
{
  const withHiddenFolder = [
    channel("a", 10),
    folder("H", 20),
    channel("h1", 10, "H"),
    channel("b", 30),
  ];
  const all = flattenSidebar(withHiddenFolder).map((r) => r.item);
  const order = restoreHiddenRows(pick(withHiddenFolder, ["b", "a"]), all, new Set(["H", "h1"]), "b");
  assert.deepEqual(ids(order), ["b", "a", "H", "h1"]);
  // Hidden rows at the very top stay at the very top.
  const first = [folder("H", 10), channel("h1", 10, "H"), channel("a", 20), channel("b", 30)];
  const allFirst = flattenSidebar(first).map((r) => r.item);
  assert.deepEqual(
    ids(restoreHiddenRows(pick(first, ["b", "a"]), allFirst, new Set(["H", "h1"]), "b")),
    ["H", "h1", "b", "a"],
  );
}

// ── Move up and Move down with rows hidden ──────────────────────────────────

{
  /* Top level: a, h1(hidden), b, h2(hidden), [F: f1, g(hidden), f2]. */
  const items = [
    channel("a", 10),
    channel("h1", 20),
    channel("b", 30),
    channel("h2", 40),
    folder("F", 50),
    channel("f1", 10, "F"),
    channel("g", 20, "F"),
    channel("f2", 30, "F"),
  ];
  const hiddenIds = new Set(["h1", "h2", "g"]);
  const all = flattenSidebar(items).map((r) => r.item);
  const drawn = flattenSidebar(items.filter((i) => !hiddenIds.has(i.id)));
  const move = (id, direction) => {
    const order = moveAmongDrawn(drawn, id, direction);
    return order && siblings(restoreHiddenRows(order, all, hiddenIds, id));
  };

  // b up steps over h1 to swap with a. h1 stays right after a, h2 where it was.
  assert.deepEqual(move("b", "up"), { "": ["b", "a", "h1", "h2", "F"], F: ["f1", "g", "f2"] });

  // a down swaps with b, the next row drawn, rather than with hidden h1. The
  // hidden rows keep their places among the rows that did not move.
  assert.deepEqual(move("a", "down"), { "": ["h1", "b", "h2", "a", "F"], F: ["f1", "g", "f2"] });

  // A folder moves as a block, over h2, with its hidden child still inside.
  assert.deepEqual(move("F", "up"), { "": ["a", "h1", "F", "b", "h2"], F: ["f1", "g", "f2"] });

  // Inside a folder, f2 up steps over g to swap with f1.
  assert.deepEqual(move("f2", "up"), { "": ["a", "h1", "b", "h2", "F"], F: ["f2", "f1", "g"] });

  // Nothing drawn that way: no move, which is also what greys the menu item out.
  assert.equal(moveAmongDrawn(drawn, "a", "up"), null);
  assert.equal(moveAmongDrawn(drawn, "F", "down"), null);
  assert.equal(moveAmongDrawn(drawn, "f1", "up"), null);
  assert.equal(moveAmongDrawn(drawn, "f2", "down"), null);

  // The payload names every row, each in the folder it was in.
  const order = restoreHiddenRows(moveAmongDrawn(drawn, "b", "up"), all, hiddenIds, "b");
  const payload = buildReorderPayload(order, items, "b", null);
  assert.deepEqual(payload.map((e) => e.itemId).sort(), ids(items).sort());
  assert.equal(payload.find((e) => e.itemId === "g").parentItemId, "F");
}

console.log("hide-muted: ok");
