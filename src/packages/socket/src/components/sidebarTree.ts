import type { SidebarItem, SidebarItemKind, SidebarReorderEntry } from "@/settings/src/types/server";

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

export interface FlattenOptions {
  /** Leave out a folder with nothing under it. Servers before GRYT-1306 send
      every folder, so one whose channels are all hidden arrives empty. */
  hideEmptyFolders?: boolean;
}

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
  { hideEmptyFolders = false }: FlattenOptions = {},
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
    const inside = children.get(item.id) ?? [];
    if (item.kind === "folder" && hideEmptyFolders && inside.length === 0) continue;
    rows.push({ item, depth: 0 });
    if (item.kind !== "folder" || collapsed.has(item.id)) continue;
    for (const child of inside.sort(byPosition)) {
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

/**
 * `order` with rows the sidebar left out put back, each after the sibling it
 * followed in `before` (or first in its folder), so a drag never drops one.
 */
export function restoreHiddenRows(
  order: SidebarItem[],
  before: SidebarItem[],
  hidden: ReadonlySet<string>,
  movedId: string,
): SidebarItem[] {
  const folders = folderIds(before);
  const startOf = (parent: string | null) => `start:${parent ?? ""}`;
  const anchored = new Map<string, SidebarItem[]>();
  const lastShown = new Map<string | null, string>();

  for (const item of before) {
    const parent = effectiveParent(item, folders);
    if (hidden.has(item.id)) {
      const key = lastShown.get(parent) ?? startOf(parent);
      anchored.set(key, [...(anchored.get(key) ?? []), item]);
    } else if (item.id !== movedId) {
      // The moved row is no anchor: what followed it stays where it was.
      lastShown.set(parent, item.id);
    }
  }

  const out: SidebarItem[] = [];
  const place = (item: SidebarItem) => {
    out.push(item);
    if (item.kind === "folder") placeAfter(startOf(item.id));
    placeAfter(item.id);
  };
  const placeAfter = (key: string) => {
    for (const item of anchored.get(key) ?? []) place(item);
  };
  placeAfter(startOf(null));
  for (const item of order) place(item);
  return out;
}

/** The rows drawn under a folder: what goes with it when it is dragged. None while it is collapsed. */
export function folderChildrenInRows(rows: SidebarRow[], folderId: string): SidebarItem[] {
  const at = rows.findIndex((r) => r.item.id === folderId && r.item.kind === "folder");
  if (at < 0) return [];
  const children: SidebarItem[] = [];
  for (let i = at + 1; i < rows.length && rows[i].depth === 1; i++) children.push(rows[i].item);
  return children;
}

/** `order` with `children` put back right under their folder, wherever the folder ended up. */
export function regroupFolder(order: SidebarItem[], folderId: string, children: SidebarItem[]): SidebarItem[] {
  const ids = new Set(children.map((c) => c.id));
  return order
    .filter((i) => !ids.has(i.id))
    .flatMap((i) => (i.id === folderId ? [i, ...children] : [i]));
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

/** Where a new channel goes. Neither field set means last at the top level. */
export interface ChannelPlacement {
  /** The folder to put it in. Null or absent is the top level. */
  folderId?: string | null;
  /** The row to put it under. Ignored unless that row is in `folderId`. */
  afterItemId?: string | null;
}

export interface NewChannelSpot {
  position: number;
  parentItemId: string | null;
  /** Set when there was no room under that row: it goes in beside it, and `orderBelow` moves it. */
  reorderBelow: string | null;
}

/** The folder a row is drawn in, or null for the top level and for a row that isn't there. */
export function folderOf(items: SidebarItem[], itemId: string): string | null {
  const item = items.find((i) => i.id === itemId);
  return item ? effectiveParent(item, folderIds(items)) : null;
}

/**
 * Where a new channel's row goes. Only siblings share an order, so "under a row" is
 * the gap before its next sibling, and a gap of one has no whole number in it.
 */
export function placeNewChannel(items: SidebarItem[], placement: ChannelPlacement = {}): NewChannelSpot {
  const folders = folderIds(items);
  const folder = placement.folderId && folders.has(placement.folderId) ? placement.folderId : null;
  const after = placement.afterItemId ? items.find((i) => i.id === placement.afterItemId) : undefined;

  if (after && effectiveParent(after, folders) === folder) {
    const siblings = items.filter((i) => effectiveParent(i, folders) === folder).sort(byPosition);
    const next = siblings[siblings.indexOf(after) + 1];
    const at = after.position ?? 0;
    if (!next) return { position: at + 10, parentItemId: folder, reorderBelow: null };
    const room = (next.position ?? 0) - at;
    if (room >= 2) return { position: at + Math.floor(room / 2), parentItemId: folder, reorderBelow: null };
    return { position: at, parentItemId: folder, reorderBelow: after.id };
  }

  const last = Math.max(0, ...items.map((i) => i.position ?? 0));
  return { position: last + 10, parentItemId: folder, reorderBelow: null };
}

/** The whole sidebar with `newId` moved to sit right under `afterId`, in that row's folder. */
export function orderBelow(
  items: SidebarItem[],
  newId: string,
  afterId: string,
): SidebarReorderEntry[] | null {
  const moved = items.find((i) => i.id === newId);
  const after = items.find((i) => i.id === afterId);
  if (!moved || !after || moved === after) return null;

  const order = flattenSidebar(items).map((r) => r.item).filter((i) => i !== moved);
  order.splice(order.indexOf(after) + 1, 0, moved);
  return buildReorderPayload(order, items, newId, effectiveParent(after, folderIds(items)));
}

const SETTINGS_TITLES: Record<SidebarItemKind, string> = {
  channel: "Channel settings",
  folder: "Folder settings",
  separator: "Separator settings",
  spacer: "Spacer settings",
};

/** The edit dialog's title for a row of this kind. */
export function settingsTitle(kind: SidebarItemKind | undefined): string {
  return (kind && SETTINGS_TITLES[kind]) || "Settings";
}
