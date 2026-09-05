/* eslint-env node */

/**
 * The sidebar is stored flat and drawn with one level of nesting, and every
 * case that could lose a channel lives in the conversion between the two.
 *
 * A channel is only on screen if a row is drawn for it. So the failures worth
 * pinning are the ones that drop a row rather than misplace it: an orphan whose
 * folder is gone, a child of a collapsed folder that nobody dragged, a drag
 * that reparents the wrong item. Each of those looks like a deleted channel to
 * whoever is looking at the sidebar.
 */

import assert from "node:assert/strict";

const {
  NEST_THRESHOLD_PX,
  buildReorderPayload,
  flattenSidebar,
  resolveDropParent,
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
  // An orphan goes to the top level rather than disappearing. The folder it
  // names is not in the list, which is what a stale server:details looks like
  // just after somebody else deleted one.
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
   * The one that would empty a folder without meaning to.
   *
   * `hidden` is inside a collapsed folder, so it was never drawn and is not in
   * the visible order. Left out of the payload the server would renumber
   * everything else around it; stated as top level it would fall out of the
   * folder. It has to come back directly after its folder, with its folder.
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

console.log("sidebar tree: ok");
