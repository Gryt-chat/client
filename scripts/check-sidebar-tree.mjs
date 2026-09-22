/* eslint-env node */

/**
 * The sidebar is stored flat and drawn with one level of nesting. The failures
 * worth pinning are the ones that drop a row rather than misplace it.
 */

import assert from "node:assert/strict";

const {
  NEST_THRESHOLD_PX,
  buildReorderPayload,
  flattenSidebar,
  folderChildrenInRows,
  folderOf,
  orderBelow,
  placeNewChannel,
  regroupFolder,
  resolveDropParent,
  settingsTitle,
} = await import("../src/packages/socket/src/components/sidebarTree.ts");

const folder = (id, position) => ({ id, kind: "folder", label: id, position });
const channel = (id, position, parentItemId = null) => ({
  id,
  kind: "channel",
  channelId: `chan-${id}`,
  position,
  parentItemId,
});

const ids = (rows) => rows.map((r) => r.item.id);
const depths = (rows) => rows.map((r) => r.depth);

// ── Flattening ──────────────────────────────────────────────────────────────

{
  // A folder is followed by its own children, whatever the raw positions say.
  const items = [
    channel("a", 10),
    folder("f", 20),
    channel("inside", 90, "f"),
    channel("b", 30),
  ];
  const rows = flattenSidebar(items);
  assert.deepEqual(ids(rows), ["a", "f", "inside", "b"]);
  assert.deepEqual(depths(rows), [0, 0, 1, 0]);
}

{
  // An orphan goes to the top level rather than disappearing. The folder it names
  // is gone, which is what a stale server:details looks like.
  const rows = flattenSidebar([channel("lost", 10, "gone")]);
  assert.deepEqual(ids(rows), ["lost"]);
  assert.deepEqual(depths(rows), [0]);
}

{
  // A parent that is not a folder is the same case.
  const rows = flattenSidebar([channel("host", 10), channel("lost", 20, "host")]);
  assert.deepEqual(depths(rows), [0, 0]);
}

{
  // Collapsed hides the children and nothing else.
  const items = [folder("f", 10), channel("x", 20, "f"), channel("y", 30)];
  assert.deepEqual(ids(flattenSidebar(items, new Set(["f"]))), ["f", "y"]);
  assert.deepEqual(ids(flattenSidebar(items)), ["f", "x", "y"]);
}

{
  // An older server sends every folder, so one whose channels are all hidden
  // from this viewer arrives empty. A member is spared the header (GRYT-1305).
  const items = [folder("empty", 10), folder("f", 20), channel("x", 30, "f"), channel("y", 40)];
  const hidden = { hideEmptyFolders: true };
  assert.deepEqual(ids(flattenSidebar(items, new Set(), hidden)), ["f", "x", "y"]);
  // An editor keeps it: a new folder is empty until something is dragged in.
  assert.deepEqual(ids(flattenSidebar(items)), ["empty", "f", "x", "y"]);
  // Shut is not empty. The children exist, they are just not drawn.
  assert.deepEqual(ids(flattenSidebar(items, new Set(["f"]), hidden)), ["f", "y"]);
  // A folder holding only a separator is empty too; that is not a channel to see into.
  const rules = [folder("f", 10), { id: "s", kind: "separator", position: 20, parentItemId: "f" }];
  assert.deepEqual(ids(flattenSidebar(rules, new Set(), hidden)), ["s"]);
}

// ── What a drag means ───────────────────────────────────────────────────────

const nestable = [folder("f", 10), channel("c", 20)];
const order = [nestable[0], nestable[1]];

{
  // Right of the threshold goes in.
  assert.equal(resolveDropParent(order, "c", NEST_THRESHOLD_PX, nestable), "f");
  assert.equal(resolveDropParent(order, "c", NEST_THRESHOLD_PX + 40, nestable), "f");
}

{
  // Short of it, a channel that was outside stays outside.
  assert.equal(resolveDropParent(order, "c", 5, nestable), null);
}

{
  // ...and a channel that was inside stays inside, so dragging it up and down
  // within its own folder does not throw it out.
  const inside = [folder("f", 10), channel("c", 20, "f")];
  assert.equal(resolveDropParent([inside[0], inside[1]], "c", 5, inside), "f");
  assert.equal(resolveDropParent([inside[0], inside[1]], "c", -3, inside), "f");
}

{
  // All the way left comes out.
  const inside = [folder("f", 10), channel("c", 20, "f")];
  assert.equal(
    resolveDropParent([inside[0], inside[1]], "c", -NEST_THRESHOLD_PX, inside),
    null,
  );
}

{
  // Only a channel nests. A folder dragged right stays where it is.
  const two = [folder("f", 10), folder("g", 20)];
  assert.equal(resolveDropParent(two, "g", 100, two), null);
}

{
  // A top-level item between the folder and the drop ends the run, so a channel
  // below an unrelated channel is not silently joining a folder further up.
  const items = [folder("f", 10), channel("outside", 20), channel("c", 30)];
  assert.equal(resolveDropParent(items, "c", 100, items), null);
}

{
  // Nothing above means nothing to join.
  const items = [channel("c", 10), folder("f", 20)];
  assert.equal(resolveDropParent(items, "c", 100, items), null);
}

// ── The payload ─────────────────────────────────────────────────────────────

{
  // Every entry states its folder outright, so the server never has to guess.
  const items = [folder("f", 10), channel("c", 20)];
  const payload = buildReorderPayload(items, items, "c", "f");
  assert.deepEqual(payload, [
    { itemId: "f", parentItemId: null },
    { itemId: "c", parentItemId: "f" },
  ]);
}

{
  /*
   * The one that would empty a folder without meaning to: `hidden` is inside a
   * collapsed folder, so it has to come back after its folder, with its folder.
   */
  const items = [folder("f", 10), channel("hidden", 20, "f"), channel("c", 30)];
  const visible = [items[0], items[2]];
  const payload = buildReorderPayload(visible, items, "c", null);
  assert.deepEqual(payload, [
    { itemId: "f", parentItemId: null },
    { itemId: "hidden", parentItemId: "f" },
    { itemId: "c", parentItemId: null },
  ]);
}

// ── Where a new channel goes ────────────────────────────────────────────────

/** The row the create dialog sends, added to the list the way the server stores it. */
const withNew = (items, spot) => [
  ...items,
  { id: "new", kind: "channel", channelId: "chan-new", position: spot.position, parentItemId: spot.parentItemId },
];

/** What `server:sidebar:reorder` does with a payload: 10, 20, 30, in the order sent. */
const reorderOnServer = (items, entries) => {
  const byId = new Map(items.map((i) => [i.id, i]));
  return entries.map((entry, n) => ({ ...byId.get(entry.itemId), position: (n + 1) * 10, parentItemId: entry.parentItemId }));
};

{
  assert.equal(folderOf([folder("f", 10), channel("x", 20, "f")], "x"), "f");
  assert.equal(folderOf([folder("f", 10), channel("x", 20)], "x"), null);
  // A folder that has gone leaves its channel at the top level, which is where it is drawn.
  assert.equal(folderOf([channel("x", 20, "gone")], "x"), null);
  assert.equal(folderOf([channel("x", 20)], "nobody"), null);
}

{
  // From the + or the list's own menu: last at the top level, below the last folder's channels.
  const items = [channel("a", 10), folder("f", 20), channel("x", 90, "f"), channel("b", 30)];
  const spot = placeNewChannel(items);
  assert.deepEqual(spot, { position: 100, parentItemId: null, reorderBelow: null });
  assert.deepEqual(ids(flattenSidebar(withNew(items, spot))), ["a", "f", "x", "b", "new"]);
}

{
  // Create channel in this folder: last inside it, and the rows after the folder stay after it.
  const items = [channel("a", 10), folder("f", 20), channel("x", 90, "f"), channel("b", 30)];
  const spot = placeNewChannel(items, { folderId: "f" });
  assert.deepEqual(spot, { position: 100, parentItemId: "f", reorderBelow: null });
  const rows = flattenSidebar(withNew(items, spot));
  assert.deepEqual(ids(rows), ["a", "f", "x", "new", "b"]);
  assert.deepEqual(depths(rows), [0, 0, 1, 1, 0]);
}

{
  // A folder id that is not a folder, or no longer exists, is the top level rather than an orphan.
  const items = [channel("a", 10), folder("f", 20)];
  assert.equal(placeNewChannel(items, { folderId: "a" }).parentItemId, null);
  assert.equal(placeNewChannel(items, { folderId: "gone" }).parentItemId, null);
}

{
  // Create channel below, with room: halfway to the next sibling, in the same folder.
  const items = [folder("f", 10), channel("x", 20, "f"), channel("y", 40, "f"), channel("b", 50)];
  const spot = placeNewChannel(items, { folderId: "f", afterItemId: "x" });
  assert.deepEqual(spot, { position: 30, parentItemId: "f", reorderBelow: null });
  assert.deepEqual(ids(flattenSidebar(withNew(items, spot))), ["f", "x", "new", "y", "b"]);
}

{
  // Under the last channel in a folder. Its position ties with a top-level row, which is
  // fine: only siblings are ordered against each other.
  const items = [folder("f", 10), channel("x", 20, "f"), channel("y", 40, "f"), channel("b", 50)];
  const spot = placeNewChannel(items, { folderId: "f", afterItemId: "y" });
  assert.deepEqual(spot, { position: 50, parentItemId: "f", reorderBelow: null });
  assert.deepEqual(ids(flattenSidebar(withNew(items, spot))), ["f", "x", "y", "new", "b"]);
}

{
  // Under a top-level channel with a folder next: between the two, not inside the folder.
  const items = [channel("a", 10), folder("f", 20), channel("x", 21, "f")];
  const spot = placeNewChannel(items, { afterItemId: "a" });
  assert.deepEqual(spot, { position: 15, parentItemId: null, reorderBelow: null });
  assert.deepEqual(ids(flattenSidebar(withNew(items, spot))), ["a", "new", "f", "x"]);
}

for (const [label, gap] of [["one apart", 1], ["on the same position", 0]]) {
  // No whole number fits, so it goes in beside the row and a reorder moves it under.
  const items = [folder("f", 10), channel("x", 20, "f"), channel("y", 20 + gap, "f"), channel("b", 30)];
  const spot = placeNewChannel(items, { folderId: "f", afterItemId: "x" });
  assert.deepEqual(spot, { position: 20, parentItemId: "f", reorderBelow: "x" }, label);

  // If the reorder never lands, it is still in the folder, next to the row it was made from.
  const landed = withNew(items, spot);
  const before = ids(flattenSidebar(landed));
  assert.deepEqual(before.filter((id) => id !== "new"), ["f", "x", "y", "b"], label);
  assert.equal(Math.abs(before.indexOf("new") - before.indexOf("x")), 1, label);

  const entries = orderBelow(landed, "new", "x");
  assert.deepEqual(entries.find((e) => e.itemId === "new"), { itemId: "new", parentItemId: "f" }, label);
  assert.equal(entries.length, landed.length, `${label}: every row is in the reorder, once`);
  const rows = flattenSidebar(reorderOnServer(landed, entries));
  assert.deepEqual(ids(rows), ["f", "x", "new", "y", "b"], label);
  assert.deepEqual(depths(rows), [0, 1, 1, 1, 0], label);
}

{
  // The same at the top level, where folders and their channels are in the way.
  const items = [channel("a", 10), channel("b", 11), folder("f", 20), channel("x", 21, "f")];
  const spot = placeNewChannel(items, { afterItemId: "a" });
  assert.equal(spot.reorderBelow, "a");
  const landed = withNew(items, spot);
  const rows = flattenSidebar(reorderOnServer(landed, orderBelow(landed, "new", "a")));
  assert.deepEqual(ids(rows), ["a", "new", "b", "f", "x"]);
  assert.deepEqual(depths(rows), [0, 0, 0, 0, 1]);
}

{
  // The dialog's folder was changed away from the row's own, so "below" no longer applies.
  const items = [folder("f", 10), channel("x", 20, "f"), channel("y", 40, "f"), folder("g", 50)];
  assert.deepEqual(
    placeNewChannel(items, { folderId: "g", afterItemId: "x" }),
    { position: 60, parentItemId: "g", reorderBelow: null },
  );
  assert.deepEqual(
    placeNewChannel(items, { folderId: null, afterItemId: "x" }),
    { position: 60, parentItemId: null, reorderBelow: null },
  );
}

{
  // A row that has gone, or never arrived, makes no reorder at all.
  const items = [channel("a", 10), channel("b", 20)];
  assert.equal(orderBelow(items, "new", "a"), null);
  assert.equal(orderBelow(items, "b", "gone"), null);
  assert.equal(orderBelow(items, "a", "a"), null);
}

// ── The edit dialog's title ─────────────────────────────────────────────────

{
  // A folder used to fall through to "Spacer settings" (GRYT-1340).
  assert.equal(settingsTitle("folder"), "Folder settings");
  assert.equal(settingsTitle("channel"), "Channel settings");
  assert.equal(settingsTitle("separator"), "Separator settings");
  assert.equal(settingsTitle("spacer"), "Spacer settings");
  // Nothing selected, which is the dialog closing, and a kind from a newer server.
  assert.equal(settingsTitle(undefined), "Settings");
  assert.equal(settingsTitle("category"), "Settings");
}

// ── Dragging a folder ───────────────────────────────────────────────────────

{
  // A folder takes the rows under it, and only those.
  const items = [channel("a", 10), folder("f", 20), channel("in1", 21, "f"), channel("in2", 22, "f"), channel("b", 30)];
  const rows = flattenSidebar(items);
  assert.deepEqual(folderChildrenInRows(rows, "f").map((i) => i.id), ["in1", "in2"]);
  // Collapsed, it has nothing drawn under it to carry.
  assert.deepEqual(folderChildrenInRows(flattenSidebar(items, new Set(["f"])), "f"), []);
  // A channel is not a folder, even at an index with depth-1 rows after it.
  assert.deepEqual(folderChildrenInRows(rows, "a"), []);

  // Dropped above "a": the children land right under it and stay in the folder.
  const children = folderChildrenInRows(rows, "f");
  const dragged = [folder("f", 20), channel("a", 10), channel("b", 30)];
  const order = regroupFolder(dragged, "f", children);
  assert.deepEqual(order.map((i) => i.id), ["f", "in1", "in2", "a", "b"]);
  assert.deepEqual(buildReorderPayload(order, items, "f", null), [
    { itemId: "f", parentItemId: null },
    { itemId: "in1", parentItemId: "f" },
    { itemId: "in2", parentItemId: "f" },
    { itemId: "a", parentItemId: null },
    { itemId: "b", parentItemId: null },
  ]);
  // A folder never lands in anything, itself included.
  assert.equal(resolveDropParent(order, "f", 200, items), null);
  // Put back once, even if the list still held one of them.
  assert.deepEqual(regroupFolder([...dragged, channel("in1", 21, "f")], "f", children).map((i) => i.id), ["f", "in1", "in2", "a", "b"]);
}

console.log("sidebar tree: ok");
