export type SfxKind = "click" | "key" | "pop" | "whoosh" | "resolve";
export type SfxEvent = { t: number; kind: SfxKind; dur?: number };

/** Logs a sound at the page's current time; render-motion.mjs mixes them into the track afterwards. */
export function sfx(kind: SfxKind, extra: { dur?: number } = {}) {
  const w = window as unknown as { __sfx?: SfxEvent[] };
  (w.__sfx ??= []).push({ t: performance.now(), kind, ...extra });
}
