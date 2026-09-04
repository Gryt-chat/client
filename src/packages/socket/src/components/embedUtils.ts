const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|ogv)(\?[^\s]*)?$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|aac|m4a|opus)(\?[^\s]*)?$/i;

/* The preview payload, the card layout rule, the failure wording and the URL
   scan moved to @gryt/core: the phone was deciding all four separately and
   arriving at the same answers. What stays here is only true of this app —
   which sites get a real player instead of a card, and the dismissal and cache
   state a desktop session keeps.

   Re-exported rather than imported directly by every consumer, so the move
   costs one import line here instead of a rename across six files. */
export {
  describePreviewFailure,
  extractUrls,
  getCardSubtitle,
  getLinkCardLayout,
  type LinkCardLayout,
  type LinkPreviewData,
} from "@gryt/core";

// A re-export does not put the name in this module's scope, and previewCache
// below is typed with it.
import type { LinkPreviewData } from "@gryt/core";

function safeParseUrl(url: string): URL | null {
  try { return new URL(url); } catch { return null; }
}

export function getTwitchEmbed(url: string): { kind: "channel" | "video" | "clip"; value: string } | null {
  const u = safeParseUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "clips.twitch.tv") {
    const slug = u.pathname.split("/").filter(Boolean)[0];
    return slug ? { kind: "clip", value: slug } : null;
  }

  if (host !== "twitch.tv") return null;

  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  // twitch.tv/videos/<id>
  if (parts[0] === "videos" && parts[1] && /^\d+$/.test(parts[1])) {
    return { kind: "video", value: `v${parts[1]}` };
  }

  // twitch.tv/<channel>/clip/<slug>
  const clipIdx = parts.findIndex((p) => p === "clip");
  if (clipIdx !== -1) {
    const slug = parts[clipIdx + 1];
    return slug ? { kind: "clip", value: slug } : null;
  }

  // twitch.tv/<channel>
  const channel = parts[0];
  if (!channel) return null;
  if (["directory", "downloads", "jobs", "login", "p", "search", "settings", "signup"].includes(channel)) return null;
  return { kind: "channel", value: channel };
}

export function getYouTubeVideoId(url: string): string | null {
  const u = safeParseUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id || null;
  }

  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") return null;

  const v = u.searchParams.get("v");
  if (v) return v;

  const parts = u.pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "shorts" || p === "embed");
  if (idx !== -1) {
    const id = parts[idx + 1];
    return id || null;
  }

  return null;
}

export function getVimeoVideoId(url: string): string | null {
  const u = safeParseUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0];
    return id && /^\d+$/.test(id) ? id : null;
  }

  if (host === "player.vimeo.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "video") {
      const id = parts[1];
      return id && /^\d+$/.test(id) ? id : null;
    }
  }

  return null;
}

function isSoundCloudUrl(url: string): boolean {
  const u = safeParseUrl(url);
  if (!u) return false;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  return host === "soundcloud.com" || host === "on.soundcloud.com";
}

export type SpotifyEmbedInfo = { embedSrc: string; height: number };

export function getSpotifyEmbed(url: string): SpotifyEmbedInfo | null {
  const u = safeParseUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "open.spotify.com") return null;

  const parts = u.pathname.split("/").filter(Boolean);
  const type = parts[0];
  const id = parts[1];
  if (!type || !id) return null;

  const allowed = new Set(["track", "album", "playlist", "artist", "show", "episode"]);
  if (!allowed.has(type)) return null;

  const embedSrc = `https://open.spotify.com/embed/${type}/${encodeURIComponent(id)}`;
  const height = type === "track" || type === "episode" ? 152 : 352;
  return { embedSrc, height };
}

export function getTikTokVideoId(url: string): string | null {
  const u = safeParseUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "tiktok.com" && host !== "vm.tiktok.com" && host !== "vt.tiktok.com") return null;

  const m1 = u.pathname.match(/\/video\/(\d{10,})/);
  if (m1?.[1]) return m1[1];

  const m2 = u.pathname.match(/(\d{10,})/);
  if (m2?.[1]) return m2[1];

  return null;
}

export function getInstagramEmbedSrc(url: string): string | null {
  const u = safeParseUrl(url);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "instagram.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const kind = parts[0];
  const shortcode = parts[1];
  if (!shortcode) return null;
  if (kind !== "p" && kind !== "reel" && kind !== "tv") return null;
  return `https://www.instagram.com/${kind}/${encodeURIComponent(shortcode)}/embed/`;
}

function isXUrl(url: string): boolean {
  const u = safeParseUrl(url);
  if (!u) return false;
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  return host === "x.com" || host === "twitter.com";
}

export type EmbedType =
  | "image"
  | "video"
  | "audio"
  | "youtube"
  | "vimeo"
  | "twitch"
  | "soundcloud"
  | "spotify"
  | "tiktok"
  | "instagram"
  | "x"
  | "link";

export function getEmbedType(url: string): EmbedType {
  if (getTwitchEmbed(url)) return "twitch";
  if (getYouTubeVideoId(url)) return "youtube";
  if (getVimeoVideoId(url)) return "vimeo";
  if (getTikTokVideoId(url)) return "tiktok";
  if (getInstagramEmbedSrc(url)) return "instagram";
  if (getSpotifyEmbed(url)) return "spotify";
  if (isSoundCloudUrl(url)) return "soundcloud";
  if (isXUrl(url)) return "x";
  if (IMAGE_EXT.test(url)) return "image";
  if (VIDEO_EXT.test(url)) return "video";
  if (AUDIO_EXT.test(url)) return "audio";
  return "link";
}


const DISMISSED_KEY = "gryt:dismissed-embeds";

function getDismissedEmbeds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function dismissEmbed(messageId: string, url: string): void {
  const dismissed = getDismissedEmbeds();
  dismissed.add(`${messageId}:${url}`);
  const arr = [...dismissed];
  if (arr.length > 1000) arr.splice(0, arr.length - 1000);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
}

export function isEmbedDismissed(messageId: string, url: string): boolean {
  return getDismissedEmbeds().has(`${messageId}:${url}`);
}

export function clearDismissedForMessage(messageId: string): void {
  const dismissed = getDismissedEmbeds();
  const prefix = `${messageId}:`;
  let changed = false;
  for (const key of dismissed) {
    if (key.startsWith(prefix)) {
      dismissed.delete(key);
      changed = true;
    }
  }
  if (changed) {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
  }
}

export const imageEmbedSizeCache = new Map<string, { width: number; height: number }>();

export type RemoteImageMetadata = { width: number | null; height: number | null };

export function parseRemoteImageMetadata(raw: unknown): RemoteImageMetadata | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const width = typeof rec.width === "number" ? rec.width : null;
  const height = typeof rec.height === "number" ? rec.height : null;
  return { width, height };
}

export const previewCache = new Map<string, LinkPreviewData>();

/**
 * URLs the server has already refused, so we stop asking. `previewCache` only
 * holds successes, so a LAN address pasted into a channel produced a 400 on
 * every mount of the card, forever.
 *
 * A 400 is the server's SSRF guard working, and that answer cannot change while
 * the process is up — session-lived, so a reload asks once more.
 *
 * **Only refusals, not failures.** A 502 or a dropped connection is worth
 * trying again and lands in neither map.
 */
export const previewRefused = new Set<string>();

export type OEmbedPayload = { html: string };

export function safeJsonParseOEmbed(raw: unknown): OEmbedPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.html !== "string") return null;
  return { html: rec.html };
}
