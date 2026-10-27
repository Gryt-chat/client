import type { ScreenWindow } from "@gryt/voice";
import { useSyncExternalStore } from "react";

export interface ShareMeta {
  name?: string;
  quality?: string;
  fps?: number;
  /** One of Gryt's own windows: its sound can't be turned on. */
  own?: boolean;
}

/** What the picker and the share menu know about each shared window, keyed by `windowKey`. */
const metas = new Map<string, ShareMeta>();
let firstKey = "";
let version = 0;
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function changed() {
  version++;
  listeners.forEach((l) => l());
}

/** A browser window has no source id, so its index stands in. */
export function windowKey(w: Pick<ScreenWindow, "index" | "sourceId">): string {
  return w.sourceId ?? `#${w.index}`;
}

export function setShareMeta(key: string, meta: ShareMeta) {
  metas.set(key, { ...metas.get(key), ...meta });
  changed();
}

/** The first window has no ScreenWindow of its own, so its key is kept here. Its quality is the saved setting. */
export function setFirstShareKey(key: string) {
  firstKey = key;
  changed();
}

/** Shares whose sound is switched off in the menu, by audio stream id. The track keeps running, so nothing else knows. */
const soundOff = new Set<string>();

export function setSoundOff(audioStreamId: string, off: boolean) {
  if (off) soundOff.add(audioStreamId);
  else soundOff.delete(audioStreamId);
  changed();
}

export function isSoundOff(audioStreamId: string): boolean {
  return soundOff.has(audioStreamId);
}

export function shareMeta(key: string): ShareMeta | undefined {
  return metas.get(key);
}

export function firstShareKey(): string {
  return firstKey;
}

/** Re-renders on any change; depend on the number it returns. */
export function useShareWindowsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
