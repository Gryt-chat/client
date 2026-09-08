/**
 * Where a plugin's panel lives between being sent and being drawn. One panel per
 * plugin, replaced rather than stacked, so nothing has to hold a handle.
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
 * Rebuilt on every change rather than sorted on read. `useSyncExternalStore`
 * compares by identity, so a fresh array each render is an infinite loop.
 */
let snapshot: ShownPanel[] = [];

function republish(): void {
  /*
   * By addon id, compared with `<` rather than `localeCompare`: under `nb` Chrome
   * answers -1 for `"zzz".localeCompare("aaa")`, so the order was not sorted.
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
 * Drop everything, for a sign-out or a reload of the addon list. Stopping each
 * plugin in turn would republish once each and redraw the sidebar as often.
 */
export function forgetPanels(): void {
  if (panels.size === 0) return;
  panels.clear();
  republish();
}
