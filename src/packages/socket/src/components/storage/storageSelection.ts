import { useSyncExternalStore } from "react";

/** Ticked files per server. Module state, so closing settings or opening a preview keeps them until a reload. */
const picked = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();
let version = 0;

function changed() {
  version++;
  listeners.forEach((fn) => fn());
}

export function selectionFor(host: string): Map<string, number> {
  let m = picked.get(host);
  if (!m) picked.set(host, (m = new Map()));
  return m;
}

export function toggleFile(host: string, fileId: string, size: number): void {
  const m = selectionFor(host);
  if (m.has(fileId)) m.delete(fileId);
  else m.set(fileId, size);
  changed();
}

export function setFiles(host: string, files: Array<{ file_id: string; size: number }>, on: boolean): void {
  const m = selectionFor(host);
  for (const f of files) {
    if (on) m.set(f.file_id, f.size);
    else m.delete(f.file_id);
  }
  changed();
}

export function clearSelection(host: string): void {
  selectionFor(host).clear();
  changed();
}

export function useSelectionVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
  );
}
