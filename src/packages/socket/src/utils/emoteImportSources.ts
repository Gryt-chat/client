/**
 * Where imported emotes can come from. One box takes a link and works out what
 * it is, rather than one box per site.
 *
 * Adding a third source means adding an entry here. Nothing else in the import
 * path knows which site an emote came from.
 */
import type { ImportEmote } from "./emoteImportUtils";

export interface EmoteListing {
  /** Shown above the list: a channel, a profile, a pack. */
  title: string | null;
  emotes: ImportEmote[];
  /** Said out loud when a listing was cut short rather than being complete. */
  note?: string;
}

export interface EmoteSource {
  /** For error messages and the placeholder. */
  label: string;
  /** Whether this source recognises the pasted link at all. */
  matches: (url: string) => boolean;
  fetchListing: (url: string, base: string) => Promise<EmoteListing>;
}

const BTTV_USER_URL_RE = /betterttv\.com\/users\/([a-f0-9]{20,30})/;
const BTTV_EMOTE_URL_RE = /betterttv\.com\/emotes\/([a-f0-9]{20,30})/;
const BTTV_CDN = "https://cdn.betterttv.net/emote";

const EMOJIGG_USER_URL_RE = /emoji\.gg\/user\/([^/?#]+)/;
const EMOJIGG_PACK_URL_RE = /emoji\.gg\/pack\/([A-Za-z0-9_-]+)/;
const EMOJIGG_EMOJI_URL_RE = /emoji\.gg\/emoji\/([A-Za-z0-9_-]+)/;

async function getJson(url: string): Promise<Record<string, unknown>> {
  const resp = await fetch(url);
  if (!resp.ok) {
    const data: unknown = await resp.json().catch(() => null);
    const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const message = typeof root.message === "string" ? root.message : `Failed to fetch (${resp.status})`;
    throw new Error(message);
  }
  const data: unknown = await resp.json();
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function bttvEmote(raw: Record<string, unknown>, base: string): ImportEmote | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const code = typeof raw.code === "string" ? raw.code : null;
  if (!id || !code) return null;

  const imageType = typeof raw.imageType === "string" ? raw.imageType : "png";
  return {
    id,
    code,
    imageType,
    animated: typeof raw.animated === "boolean" ? raw.animated : imageType.toLowerCase() === "gif",
    previewUrl: `${BTTV_CDN}/${id}/2x`,
    fileUrl: `${base}/api/emojis/bttv/file/${id}`,
  };
}

export const BTTV_SOURCE: EmoteSource = {
  label: "BetterTTV",
  matches: (url) => BTTV_USER_URL_RE.test(url) || BTTV_EMOTE_URL_RE.test(url),
  fetchListing: async (url, base) => {
    const emoteMatch = url.match(BTTV_EMOTE_URL_RE);
    if (emoteMatch) {
      const data = await getJson(`${base}/api/emojis/bttv/emote/${emoteMatch[1]}`);
      const raw = data.emote && typeof data.emote === "object" ? (data.emote as Record<string, unknown>) : {};
      const emote = bttvEmote({ id: emoteMatch[1], ...raw }, base);
      if (!emote) throw new Error("BetterTTV returned an invalid emote payload.");
      return { title: "Single emote", emotes: [emote] };
    }

    const userMatch = url.match(BTTV_USER_URL_RE);
    if (!userMatch) throw new Error("Not a BetterTTV link.");

    const data = await getJson(`${base}/api/emojis/bttv/user/${userMatch[1]}`);
    const lists = [data.channelEmotes, data.sharedEmotes];
    const emotes: ImportEmote[] = [];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const emote = bttvEmote(raw as Record<string, unknown>, base);
        if (emote) emotes.push(emote);
      }
    }
    return { title: typeof data.username === "string" ? data.username : null, emotes };
  },
};

function emojiGgEmote(raw: unknown, base: string): ImportEmote | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const id = typeof record.id === "string" ? record.id : null;
  const code = typeof record.code === "string" ? record.code : null;
  const url = typeof record.url === "string" ? record.url : null;
  if (!id || !code || !url) return null;

  const imageType = typeof record.imageType === "string" ? record.imageType : "png";
  return {
    id,
    code,
    imageType,
    animated: typeof record.animated === "boolean" ? record.animated : imageType === "gif",
    previewUrl: url,
    fileUrl: `${base}/api/emojis/emojigg/file?url=${encodeURIComponent(url)}`,
  };
}

async function emojiGgListing(path: string, base: string): Promise<EmoteListing> {
  const data = await getJson(`${base}/api/emojis/emojigg/${path}`);
  const raw = Array.isArray(data.emotes) ? data.emotes : [];
  const emotes = raw
    .map((e) => emojiGgEmote(e, base))
    .filter((e): e is ImportEmote => e !== null);

  return {
    title: typeof data.title === "string" ? data.title : null,
    emotes,
    // The server stops after a fixed number of profile pages. Saying so beats
    // handing over a short list that looks like the whole thing.
    note: data.truncated === true
      ? "That profile has more than this import will read in one go — the newest are listed."
      : undefined,
  };
}

export const EMOJIGG_SOURCE: EmoteSource = {
  label: "emoji.gg",
  matches: (url) =>
    EMOJIGG_USER_URL_RE.test(url) ||
    EMOJIGG_PACK_URL_RE.test(url) ||
    EMOJIGG_EMOJI_URL_RE.test(url),
  fetchListing: async (url, base) => {
    // Order matters: /emoji/ and /pack/ are more specific than /user/, and a
    // username can contain anything, so the narrow patterns go first.
    const emoji = url.match(EMOJIGG_EMOJI_URL_RE);
    if (emoji) return emojiGgListing(`emoji/${emoji[1]}`, base);

    const pack = url.match(EMOJIGG_PACK_URL_RE);
    if (pack) return emojiGgListing(`pack/${pack[1]}`, base);

    const user = url.match(EMOJIGG_USER_URL_RE);
    if (user) return emojiGgListing(`user/${encodeURIComponent(user[1])}`, base);

    throw new Error("Not an emoji.gg link.");
  },
};

export const EMOTE_SOURCES = [BTTV_SOURCE, EMOJIGG_SOURCE];

export function sourceForUrl(url: string): EmoteSource | null {
  return EMOTE_SOURCES.find((source) => source.matches(url)) ?? null;
}
