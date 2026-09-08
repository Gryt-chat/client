import type { SidebarItem, SidebarReorderEntry } from "@/settings/src/types/server";

/**
 * The sidebar is stored flat and drawn as one level of nesting; this turns one
 * into the other. The component renders rows, this decides what the rows are.
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
 * Orphans go to the top level rather than vanishing with a stale folder.
 */
function effectiveParent(item: SidebarItem, folders: Set<string>): string | null {
  if (item.kind !== "channel") return null;
  const parent = item.parentItemId ?? null;
  if (!parent || !folders.has(parent)) return null;
  return parent;
}

/**
 * Flat list to drawn order. `collapsed` drops a folder's children from the
 * output; `buildReorderPayload` puts them back, so collapsing does not empty it.
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
 * The folder a dragged item lands in, from where it was dropped and how far right
 * it travelled. Between the thresholds is "no opinion", which keeps membership.
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
 * The full order to send, with every item's folder stated outright. Children of a
 * collapsed folder are put back directly after it so positions still match.
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
