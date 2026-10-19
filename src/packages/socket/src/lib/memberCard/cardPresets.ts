/**
 * Cards you saved, kept on this device with their banners. Nothing here goes to a server:
 * picking one puts the style and the banner back in the editor, and Save sends them as usual.
 */

import { useSyncExternalStore } from "react";

import { cardProfileOf, type CardStyle, cardStyleForWire } from "./cardStyle";

/** `banner` is null for "no banner", and absent when the preset predates banners being kept. */
export interface CardPreset {
  id: string;
  style: CardStyle;
  banner?: Blob | null;
  savedAt: number;
}

interface StoredPreset {
  id: string;
  style: unknown;
  banner?: Blob | null;
  savedAt: number;
}

export const PRESET_MAX = 12;
const DB_NAME = "gryt-card-presets";
const STORE = "presets";
const LEGACY_KEY = "memberCardHistory";
// The banner on your card now, so a Save that didn't touch it still keeps it with the preset.
const CURRENT_BANNER = "current-banner";

const listeners = new Set<() => void>();
let presets: CardPreset[] = [];
let loaded: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
      req.result.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("couldn't open card presets"));
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve((req ? req.result : undefined) as T);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("card presets write failed"));
    };
  });
}

const styleOf = (raw: unknown): CardStyle => cardProfileOf({ cardStyle: raw }).cardStyle;
const wire = (s: CardStyle) => JSON.stringify(cardStyleForWire(s));

function publish(next: CardPreset[]): void {
  presets = next;
  listeners.forEach((fn) => fn());
}

/** The swatches from before presets kept banners come across once, with no banner attached. */
async function migrate(): Promise<CardPreset[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "[]");
  } catch {
    raw = [];
  }
  const old = Array.isArray(raw) ? raw.slice(0, PRESET_MAX) : [];
  const now = Date.now();
  const moved = old.map((style, i): StoredPreset => ({ id: crypto.randomUUID(), style, savedAt: now - i }));
  if (moved.length) await run(STORE, "readwrite", (s) => moved.forEach((p) => s.put(p)));
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Left behind, it is only read once more and then skipped as already migrated.
  }
  return moved.map((p) => ({ ...p, style: styleOf(p.style) }));
}

function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      const stored = await run<StoredPreset[]>(STORE, "readonly", (s) => s.getAll());
      const list = stored.length
        ? stored.map((p) => ({ ...p, style: styleOf(p.style) }))
        : await migrate();
      publish(list.sort((a, b) => b.savedAt - a.savedAt));
    } catch {
      // No IndexedDB (a private window, say): presets just aren't kept.
    }
  })();
  return loaded;
}

async function sameBanner(a: Blob | null | undefined, b: Blob | null | undefined): Promise<boolean> {
  if (!a || !b) return a === b;
  if (a.size !== b.size || a.type !== b.type) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  return u.every((byte, i) => byte === v[i]);
}

/**
 * Keeps this card, newest first. `banner` undefined means the banner wasn't changed, so the one
 * on the card now goes with it. The plain card with no banner isn't worth keeping.
 */
export async function saveCardPreset(style: CardStyle, banner: Blob | null | undefined): Promise<void> {
  await load();
  try {
    // Absent reads back as undefined and a removed banner as null, which is the difference wanted.
    if (banner === undefined) banner = await run<Blob | null | undefined>("meta", "readonly", (s) => s.get(CURRENT_BANNER));
    else await run("meta", "readwrite", (s) => s.put(banner, CURRENT_BANNER));
    if (cardStyleForWire(style) === null && !banner) return;
    const dupes: string[] = [];
    for (const p of presets) {
      // A migrated swatch has no banner on record, so this one, which knows its banner, replaces it.
      if (wire(p.style) === wire(style) && (p.banner === undefined || (await sameBanner(p.banner, banner)))) dupes.push(p.id);
    }
    const preset: CardPreset = { id: crypto.randomUUID(), style, banner, savedAt: Date.now() };
    const kept = [preset, ...presets.filter((p) => !dupes.includes(p.id))];
    const dropped = kept.slice(PRESET_MAX).map((p) => p.id);
    await run(STORE, "readwrite", (s) => {
      s.put({ ...preset, style: cardStyleForWire(style) });
      [...dupes, ...dropped].forEach((id) => s.delete(id));
    });
    publish(kept.slice(0, PRESET_MAX));
  } catch {
    // Presets are a convenience; a failed write costs nothing else.
  }
}

/** Forgets a preset, and its banner with it, since the blob lives in the same record. */
export async function forgetCardPreset(id: string): Promise<void> {
  await load();
  publish(presets.filter((p) => p.id !== id));
  try {
    await run(STORE, "readwrite", (s) => s.delete(id));
  } catch {
    // Already gone from the list; the next load would show it again, which is harmless.
  }
}

export function useCardPresets(): CardPreset[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      void load();
      return () => listeners.delete(fn);
    },
    () => presets,
  );
}
