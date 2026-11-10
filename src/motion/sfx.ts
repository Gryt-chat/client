export type SfxKind =
  | "click" | "key" | "force" | "bubble" | "message" | "send" | "react" | "open" | "create" | "join" | "voice"
  | "cam" | "share" | "dress" | "appear" | "whoosh" | "fly" | "flap" | "sort" | "resolve";
export type SfxEvent = { t: number; kind: SfxKind; dur?: number; rate?: number };

/** Logs a sound at the page's current time; render-motion.mjs mixes them into the track afterwards. */
export function sfx(kind: SfxKind, extra: { dur?: number; rate?: number } = {}) {
  const w = window as unknown as { __sfx?: SfxEvent[] };
  (w.__sfx ??= []).push({ t: performance.now(), kind, ...extra });
}
