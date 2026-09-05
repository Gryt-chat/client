import type { SidebarItem, SidebarReorderEntry } from "@/settings/src/types/server";

/**
 * The sidebar is stored flat and drawn as one level of nesting, and this is the
 * piece that turns one into the other.
 *
 * Separate from `ChannelList` because it is the part with cases in it: what a
 * drag means, where an orphan goes, what a collapsed folder does to an order
 * that never saw its children. The component renders rows; this decides what
 * the rows are.
 */

/** How far right a channel has to travel before it drops into the folder above. */
export const NEST_THRESHOLD_PX = 24;

export interface SidebarRow {
  item: SidebarItem;
  /** 0 for the top level, 1 for inside a folder. There is no 2. */
  depth: 0 | 1;
}

const byPosition = (a: SidebarItem, b: SidebarItem) =>
  (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id);

/**
 * Which items are real folders, so a `parentItemId` can be checked against
 * something rather than believed.
 */
function folderIds(items: SidebarItem[]): Set<string> {
  return new Set(items.filter((i) => i.kind === "folder").map((i) => i.id));
}

/**
 * The parent this item actually has, which is not always the one it claims.
 *
 * A channel naming a folder that is not in this list is an orphan, and orphans
 * go to the top level. The server resolves the same way, but the client sees a
 * narrower list than the server stores: a folder is never hidden, but a client
 * can hold a stale `server:details` for a moment after one is deleted, and a
 * channel that vanished because its folder did would be the worse failure.
 */
function effectiveParent(item: SidebarItem, folders: Set<string>): string | null {
  if (item.kind !== "channel") return null;
  const parent = item.parentItemId ?? null;
  if (!parent || !folders.has(parent)) return null;
  return parent;
}

/**
 * Flat list to drawn order: every top-level item in position order, and each
 * folder followed immediately by its own children.
 *
 * `collapsed` drops a folder's children from the output. They keep their parent
 * and are put back by `buildReorderPayload`, so collapsing a folder and
 * dragging something else does not empty it.
 */
export function flattenSidebar(
  items: SidebarItem[],
  collapsed: ReadonlySet<string> = new Set(),
): SidebarRow[] {
  const folders = folderIds(items);
  const children = new Map<string, SidebarItem[]>();
  const top: SidebarItem[] = [];

  for (const item of items) {
    const parent = effectiveParent(item, folders);
    if (parent) {
      const list = children.get(parent) ?? [];
      list.push(item);
      children.set(parent, list);
    } else {
      top.push(item);
    }
  }

  const rows: SidebarRow[] = [];
  for (const item of [...top].sort(byPosition)) {
    rows.push({ item, depth: 0 });
    if (item.kind !== "folder" || collapsed.has(item.id)) continue;
    for (const child of (children.get(item.id) ?? []).sort(byPosition)) {
      rows.push({ item: child, depth: 1 });
    }
  }
  return rows;
}

/**
 * The folder a dragged item lands in, from where it was dropped and how far
 * right it travelled.
 *
 * Horizontal distance decides, because that is the gesture: right of the
 * threshold goes into the folder above, left of it comes back out. Between the
 * two is "no opinion", which keeps whatever membership the item already had —
 * so dragging a channel up and down inside its folder does not throw it out.
 *
 * `order` is the visible order after the drag, which is what the component has.
 */
export function resolveDropParent(
  order: SidebarItem[],
  movedId: string,
  offsetX: number,
  allItems: SidebarItem[],
): string | null {
  const moved = allItems.find((i) => i.id === movedId);
  if (!moved || moved.kind !== "channel") return null;

  const index = order.findIndex((i) => i.id === movedId);
  if (index < 0) return null;

  const folders = folderIds(allItems);

  // The nearest folder above the drop, which is the only one it could join.
  let folderAbove: string | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = order[i];
    if (candidate.kind === "folder") { folderAbove = candidate.id; break; }
    // A top-level item that is not a folder ends the run: anything below it is
    // outside whatever folder came before.
    if (effectiveParent(candidate, folders) === null) break;
  }
  if (!folderAbove) return null;

  if (offsetX >= NEST_THRESHOLD_PX) return folderAbove;
  if (offsetX <= -NEST_THRESHOLD_PX) return null;
  return effectiveParent(moved, folders) === folderAbove ? folderAbove : null;
}

/**
 * The full order to send, with every item's folder stated outright.
 *
 * Explicit rather than relying on the server's "keep what is stored" path,
 * because the client already knows the answer and a payload that says it cannot
 * be misread. The bare-id form still exists on the server for clients that
 * predate folders.
 *
 * Children of a collapsed folder are not in `visibleOrder` — nobody dragged
 * them and they were never drawn. They are put back directly after their folder
 * so the positions the server writes match what the next client will flatten.
 */
export function buildReorderPayload(
  visibleOrder: SidebarItem[],
  allItems: SidebarItem[],
  movedId: string,
  movedParent: string | null,
): SidebarReorderEntry[] {
  const folders = folderIds(allItems);
  const parentOf = (item: SidebarItem) =>
    item.id === movedId ? movedParent : effectiveParent(item, folders);

  const visible = new Set(visibleOrder.map((i) => i.id));
  const hiddenChildren = new Map<string, SidebarItem[]>();
  for (const item of allItems) {
    if (visible.has(item.id)) continue;
    const parent = parentOf(item);
    if (!parent) continue;
    const list = hiddenChildren.get(parent) ?? [];
    list.push(item);
    hiddenChildren.set(parent, list);
  }

  const entries: SidebarReorderEntry[] = [];
  for (const item of visibleOrder) {
    entries.push({ itemId: item.id, parentItemId: parentOf(item) });
    for (const child of (hiddenChildren.get(item.id) ?? []).sort(byPosition)) {
      entries.push({ itemId: child.id, parentItemId: item.id });
    }
  }
  return entries;
}

/** Whether an order differs from another, by id and by folder. */
export function orderChanged(
  before: SidebarRow[],
  afterIds: string[],
  movedId: string,
  movedParent: string | null,
): boolean {
  const beforeIds = before.map((r) => r.item.id);
  if (beforeIds.join(",") !== afterIds.join(",")) return true;
  const moved = before.find((r) => r.item.id === movedId);
  const was = moved?.item.parentItemId ?? null;
  return was !== movedParent;
}
