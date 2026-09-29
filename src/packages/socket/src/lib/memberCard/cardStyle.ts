/**
 * A member's card style and the words on their card, as the server sends them, checked
 * again here. Style codes use the mockup's query format, like theme links do.
 */

import { patternId } from "./patterns.ts";

export type CardFill = "owl" | "solid" | "gradient";

export interface CardStyle {
  fill: CardFill;
  c1?: string;
  c2?: string;
  angle: number;
  pattern: string;
  cover: "banner" | "card";
  /** "banner" fades the whole banner into the card; "bottom" only its lower edge. */
  fade: "bottom" | "banner";
  /** Whether the colour fills the whole card or only the banner and band. */
  colours: "card" | "banner";
}

export const DEFAULT_ANGLE = 135;

export const DEFAULT_CARD_STYLE: CardStyle = {
  fill: "owl",
  angle: DEFAULT_ANGLE,
  pattern: "none",
  cover: "banner",
  fade: "bottom",
  colours: "card",
};

export const BIO_MAX = 190;
export const PRONOUNS_MAX = 40;
export const STATUS_LINE_MAX = 80;

/** `#rrggbb` in lower case, or null. Accepts it with or without the hash. */
export function hexColour(value: unknown): string | null {
  const h = String(value ?? "").trim().replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(h) ? "#" + h : null;
}

/** Whatever the server sent, with each bad field back at its default. */
export function normalizeCardStyle(raw: unknown): CardStyle {
  const out: CardStyle = { ...DEFAULT_CARD_STYLE };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const c1 = hexColour(r.c1);
  const c2 = hexColour(r.c2);
  // A gradient missing its second colour is still a colour somebody picked, as on the server.
  if (r.fill === "gradient" && c1 && c2) Object.assign(out, { fill: "gradient", c1, c2 });
  else if ((r.fill === "solid" || r.fill === "gradient") && c1) Object.assign(out, { fill: "solid", c1, c2: c1 });
  const angle = Number(r.angle);
  if (r.angle !== undefined && r.angle !== null && Number.isFinite(angle) && angle >= 0 && angle <= 360) {
    out.angle = Math.round(angle);
  }
  out.pattern = patternId(r.pattern);
  if (r.cover === "card") out.cover = "card";
  if (r.fade === "banner") out.fade = "banner";
  if (r.colours === "banner") out.colours = "banner";
  return out;
}

/** The style as the server stores it: defaults left out, so the default card is null. */
export function cardStyleForWire(style: CardStyle): Partial<CardStyle> | null {
  const s = normalizeCardStyle(style);
  const out: Partial<CardStyle> = {};
  if (s.fill !== "owl" && s.c1) {
    out.fill = s.fill;
    out.c1 = s.c1;
    if (s.fill === "gradient") {
      out.c2 = s.c2;
      if (s.angle !== DEFAULT_ANGLE) out.angle = s.angle;
    }
  }
  if (s.pattern !== "none") out.pattern = s.pattern;
  if (s.cover === "card") out.cover = "card";
  if (s.fade === "banner") out.fade = "banner";
  if (s.colours === "banner") out.colours = "banner";
  return Object.keys(out).length ? out : null;
}

export function sameCardStyle(a: CardStyle, b: CardStyle): boolean {
  return JSON.stringify(cardStyleForWire(a)) === JSON.stringify(cardStyleForWire(b));
}

/* Bidi overrides and every control character, so a bio cannot reorder a name next to it. */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** One line of text, trimmed, cut to `max` characters. Empty is null. */
export function cardText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const flat = value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : flat;
}

export interface CardProfile {
  cardStyle: CardStyle;
  bio: string | null;
  pronouns: string | null;
  statusLine: string | null;
}

/** A member's card fields, from a member-list entry that may predate them all. */
export function cardProfileOf(member: {
  cardStyle?: unknown;
  bio?: unknown;
  pronouns?: unknown;
  statusLine?: unknown;
}): CardProfile {
  return {
    cardStyle: normalizeCardStyle(member.cardStyle),
    bio: cardText(member.bio, BIO_MAX),
    pronouns: cardText(member.pronouns, PRONOUNS_MAX),
    statusLine: cardText(member.statusLine, STATUS_LINE_MAX),
  };
}

/* ── style codes ─────────────────────────────────────────────────────────── */

/** The mockup's card ids. Every code names one; the client draws B4b whatever it says. */
const TEMPLATES = ["b4a", "b4b", "b4c", "b4d", "b1", "b1cut", "b2", "b3", "a", "c", "d"];

/**
 * The style as query parameters, only what differs, bare hex. It never carries a
 * banner picture, a bio or pronouns.
 */
export function encodeCardStyle(style: CardStyle): string {
  const st = normalizeCardStyle(style);
  const q = new URLSearchParams();
  q.set("card", "b4b");
  if (st.fill !== "owl" && st.c1) {
    q.set("colour", st.fill);
    q.set("c1", st.c1.replace("#", ""));
    if (st.fill === "gradient" && st.c2) {
      q.set("c2", st.c2.replace("#", ""));
      if (st.angle !== DEFAULT_ANGLE) q.set("angle", String(st.angle));
    }
  }
  if (st.pattern !== "none") q.set("pattern", st.pattern);
  if (st.colours !== "card") q.set("fill", st.colours);
  if (st.colours === "card" && st.cover === "card") q.set("cover", "card");
  if (st.colours === "card" && st.fade === "banner") q.set("fade", "full");
  return q.toString();
}

/** Whatever somebody pasted: a code, a link ending in one, or the JSON form. Null if none. */
export function decodeCardStyle(input: unknown): CardStyle | null {
  const text = String(input ?? "").trim();
  if (!text) return null;
  let raw: Record<string, unknown>;
  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      raw = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  } else {
    const q = new URLSearchParams(text.includes("?") ? text.slice(text.indexOf("?") + 1) : text);
    raw = Object.fromEntries(q.entries());
  }
  const out: CardStyle = { ...DEFAULT_CARD_STYLE };
  let present = false;
  if (TEMPLATES.includes(String(raw.card ?? "").toLowerCase())) present = true;
  if (raw.colour === "solid" || raw.colour === "gradient") {
    const c1 = hexColour(raw.c1);
    const c2 = hexColour(raw.c2);
    if (c1 && (raw.colour === "solid" || c2)) {
      Object.assign(out, { fill: raw.colour, c1, c2: c2 ?? c1 });
      present = true;
    }
  }
  const angle = Number(raw.angle);
  if (raw.angle !== undefined && Number.isFinite(angle) && angle >= 0 && angle <= 360) out.angle = Math.round(angle);
  if (typeof raw.pattern === "string" && patternId(raw.pattern) === raw.pattern) {
    out.pattern = raw.pattern;
    present = true;
  }
  if (raw.fill === "banner") out.colours = "banner";
  if (raw.cover === "card") out.cover = "card";
  if (raw.fade === "full") out.fade = "banner";
  return present ? out : null;
}
