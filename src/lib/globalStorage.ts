/**
 * Backs localStorage with a JSON file in Electron's userData directory.
 *
 * Call `initGlobalStorage()` once **before** React renders: it patches
 * `localStorage.setItem` and `removeItem` to sync writes through, so anything
 * written before that never reaches the file store. A no-op on the web.
 */

import { getElectronAPI, isElectron } from "./electron";

const MIGRATED_KEY = "_migrated";

export async function initGlobalStorage(): Promise<void> {
  if (!isElectron()) return;

  const api = getElectronAPI();
  if (!api) return;

  const store = await api.loadGlobalStore();

  // ── Migration: first launch after upgrade ──────────────────────
  if (!store[MIGRATED_KEY]) {
    console.log("[GlobalStorage] Running one-time localStorage → file migration");
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("user:")) continue;
      const value = localStorage.getItem(key);
      if (value !== null) {
        store[key] = value;
        count++;
      }
    }
    store[MIGRATED_KEY] = true;
    api.saveGlobalStore(store as Record<string, unknown>);
    console.log(`[GlobalStorage] Migrated ${count} keys to file store`);
  }

  // ── Restore: file store → localStorage ─────────────────────────
  const origSetItem = localStorage.setItem.bind(localStorage);
  let restored = 0;
  for (const [key, value] of Object.entries(store)) {
    if (key === MIGRATED_KEY) continue;
    if (typeof value === "string") {
      origSetItem(key, value);
      restored++;
    }
  }
  console.log(`[GlobalStorage] Restored ${restored} keys into localStorage`);

  // ── Patch: auto-sync future writes to file store ───────────────
  const origRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = (key: string, value: string) => {
    console.log("[GlobalStorage] setItem:", key, "length:", value.length);
    origSetItem(key, value);
    api.setGlobalData(key, value);
  };

  localStorage.removeItem = (key: string) => {
    console.log("[GlobalStorage] removeItem:", key);
    origRemoveItem(key);
    api.deleteGlobalData(key);
  };
}
