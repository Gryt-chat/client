/**
 * Where a plugin's panel lives between being sent and being drawn (GRYT-951).
 *
 * One panel per plugin. A second `gryt.ui.panel()` replaces the first rather
 * than stacking, so a plugin never has to hold a handle or remember to take an
 * old one down — the presence example calls it on every roster and would
 * otherwise leak a panel a minute.
 *
 * A plain store with subscribers rather than a React context, for the same
 * reason `pluginMessages.ts` next door is one: the plugin host is not a
 * component and cannot reach a hook, and the sidebar that draws these is four
 * levels down from anywhere a provider would sensibly go.
 */

import type { PluginPanel } from "./workerProtocol";

/** A panel and the plugin that asked for it. */
export interface ShownPanel {
  addonId: string;
  /** The addon's `name` from its manifest, which is what a person recognises. */
  addonName: string;
  panel: PluginPanel;
}

const panels = new Map<string, ShownPanel>();
const listeners = new Set<() => void>();

/*
 * Rebuilt on every change rather than sorted on read.
 *
 * `useSyncExternalStore` compares what `getSnapshot` returns by identity and
 * calls it on every render, so returning a fresh array each time is an infinite
 * loop. This is the cached one; it changes only when a panel does.
 */
let snapshot: ShownPanel[] = [];

function republish(): void {
  /*
   * By addon id, so two plugins do not swap places when one of them updates.
   * These sit in a rail somebody's eye goes to, and things moving under it is
   * worse than the order being arbitrary.
   *
   * Compared with `<` rather than `localeCompare`, which was the first version
   * and was wrong in a way only running it showed: under this machine's `nb`
   * locale Chrome answers -1 for `"zzz".localeCompare("aaa")`, so the list came
   * out in an order nobody would call sorted — and would have come out in a
   * different one on a machine set to something else. "Stable" has to mean the
   * same everywhere or it is not worth claiming. An addon id is lower-case
   * letters, digits, dot, dash and underscore, so there is no accented
   * character here for a collator to have an opinion about anyway.
   */
  snapshot = [...panels.values()].sort((a, b) => (a.addonId < b.addonId ? -1 : a.addonId > b.addonId ? 1 : 0));
  for (const listener of listeners) listener();
}

export function showPanel(addonId: string, addonName: string, panel: PluginPanel): void {
  panels.set(addonId, { addonId, addonName, panel });
  republish();
}

export function hidePanel(addonId: string): void {
  if (!panels.delete(addonId)) return;
  republish();
}

/** Everything to draw, in a stable order. */
export function shownPanels(): ShownPanel[] {
  return snapshot;
}

export function subscribePanels(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Drop everything, for a sign-out or a reload of the addon list.
 *
 * Separate from `hidePanel` per plugin because stopping every plugin one at a
 * time would republish once each, and the sidebar would redraw as many times.
 */
export function forgetPanels(): void {
  if (panels.size === 0) return;
  panels.clear();
  republish();
}
