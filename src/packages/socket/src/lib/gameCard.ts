import type { RichActivity } from "../../../../lib/richActivity";

/**
 * What a Rich Presence card says, worked out apart from the drawing so every case
 * can be tested. The server already checked the fields; this decides the words.
 */

const VERB: Record<RichActivity["type"], string> = {
  playing: "Playing",
  listening: "Listening to",
  watching: "Watching",
  competing: "Competing in",
};

export function cardHeading(card: RichActivity): string {
  return VERB[card.type] ?? VERB.playing;
}

/** Minutes and seconds, with hours once there are any. Nothing for a start in the future. */
export function elapsed(startedAt: number | undefined, now: number): string | null {
  if (startedAt === undefined || !Number.isFinite(startedAt) || startedAt > now) return null;
  const total = Math.floor((now - startedAt) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function partyText(party: RichActivity["party"]): string | null {
  if (!party) return null;
  return party.max ? `${party.size} of ${party.max}` : `${party.size} in party`;
}

/** Mirrored icons, never Discord's CDN. Null with no id, so nothing is drawn. */
export function gameIconUrl(appId: string | undefined): string | null {
  if (!appId || !/^\d{1,32}$/.test(appId)) return null;
  return `https://cdn.jsdelivr.net/gh/Gryt-chat/rich-presence@main/icons/${appId}.avif`;
}

/**
 * A button's link and the host to show beside it. Checked again here, so a card
 * from an older or modified server still can't hand over a script or a file.
 */
export function buttonLink(url: string): { href: string; host: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  return { href: parsed.href, host: parsed.hostname.replace(/^www\./, "") };
}
