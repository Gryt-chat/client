import type { IconType } from "react-icons";
import {
  SiApplemusic, SiArxiv, SiBandcamp, SiBehance, SiBluesky, SiCloudflare,
  SiCodepen, SiCodesandbox, SiCurseforge, SiDevdotto, SiDiscord, SiDocker,
  SiDribbble, SiEpicgames, SiFacebook, SiFigma, SiFlickr, SiGiphy, SiGithub,
  SiGitlab, SiGogdotcom, SiGoodreads, SiGoogledrive, SiGooglemaps, SiImdb,
  SiImgur, SiInstagram, SiInternetarchive, SiItchdotio, SiJira, SiKick,
  SiLastdotfm, SiLetterboxd, SiLinear, SiLinkedin, SiMastodon, SiMdnwebdocs,
  SiMedium, SiMixcloud, SiModrinth, SiNetlify, SiNexusmods, SiNintendo,
  SiNotion, SiNpm, SiObsidian, SiOpenstreetmap, SiPinterest, SiPlaystation,
  SiPypi, SiReddit, SiReplit, SiRumble, SiRust, SiSnapchat, SiSoundcloud,
  SiSpotify, SiStackblitz, SiStackoverflow, SiSteam, SiTelegram, SiThreads,
  SiTidal, SiTiktok, SiTrello, SiTwitch, SiVercel, SiVimeo, SiWikipedia,
  SiWolfram, SiX, SiYcombinator, SiYoutube,
} from "react-icons/si";

/**
 * Who a link belongs to, worked out from the URL alone.
 *
 * The point of knowing is that a card can carry a site's identity before its
 * metadata arrives, and can still carry it when the metadata never does — a
 * private repository, a page behind Cloudflare, a site that blocks whatever
 * fetches previews. Those used to draw a bare hostname and an empty grey box.
 *
 * This is deliberately not the list of sites that "work". Any site with
 * OpenGraph tags gets a full card without appearing here, and one that
 * declares a `theme-color` gets a coloured one. What being on this list buys
 * is a real logo instead of a favicon, a brand colour that does not depend on
 * the site declaring one, and for a few of them a line read straight out of
 * the path.
 */
export interface EmbedProvider {
  id: string;
  /** Shown where the hostname would otherwise go. */
  label: string;
  /**
   * The brand colour, used for the card's accent edge.
   *
   * `dark` exists because a handful of brands are essentially black, which is
   * invisible against a dark card. Where it is set, it is the same hue lifted
   * far enough to be seen rather than a different colour.
   */
  brand: string;
  brandDark?: string;
  Icon: IconType;
  hosts: string[];
  /** Matched against the end of the hostname, for sites with many subdomains. */
  hostSuffixes?: string[];
  /** A line derived from the path, for when the metadata is thin or missing. */
  detail?: (url: URL) => string | null;
}

const seg = (url: URL): string[] => url.pathname.split("/").filter(Boolean);

/** `owner/repo`, plus what the rest of the path says it is. */
function githubDetail(url: URL): string | null {
  const p = seg(url);
  if (p.length === 0) return null;
  if (p.length === 1) return `@${p[0]}`;
  const repo = `${p[0]}/${p[1]}`;
  const kind = p[2];
  const number = p[3];
  if (kind === "pull" && number) return `${repo} · pull request #${number}`;
  if (kind === "issues" && number) return `${repo} · issue #${number}`;
  if (kind === "releases") return `${repo} · releases`;
  if (kind === "commit" && number) return `${repo} · commit ${number.slice(0, 7)}`;
  if (kind === "tree" && number) return `${repo} · ${number}`;
  if (kind === "blob" && number) return `${repo} · ${p.slice(4).join("/") || number}`;
  return repo;
}

function modrinthDetail(url: URL): string | null {
  const p = seg(url);
  const kinds: Record<string, string> = {
    mod: "Mod", plugin: "Plugin", datapack: "Data pack",
    shader: "Shader", resourcepack: "Resource pack", modpack: "Modpack",
  };
  if (p.length >= 2 && kinds[p[0]]) return `${kinds[p[0]]} · ${p[1]}`;
  if (p[0] === "user" && p[1]) return `@${p[1]}`;
  return null;
}

function redditDetail(url: URL): string | null {
  const p = seg(url);
  if (p[0] === "r" && p[1]) return p[2] === "comments" ? `r/${p[1]} · post` : `r/${p[1]}`;
  if ((p[0] === "u" || p[0] === "user") && p[1]) return `u/${p[1]}`;
  return null;
}

function npmDetail(url: URL): string | null {
  const p = seg(url);
  if (p[0] !== "package" || !p[1]) return null;
  return p[1].startsWith("@") && p[2] ? `${p[1]}/${p[2]}` : p[1];
}

function wikipediaDetail(url: URL): string | null {
  const p = seg(url);
  const i = p.indexOf("wiki");
  const article = i !== -1 ? p[i + 1] : undefined;
  if (!article) return null;
  try {
    return decodeURIComponent(article).replace(/_/g, " ");
  } catch {
    return article.replace(/_/g, " ");
  }
}

function steamDetail(url: URL): string | null {
  const p = seg(url);
  if (p[0] === "app" && p[2]) return decodeURIComponent(p[2]).replace(/_/g, " ");
  if (p[0] === "app" && p[1]) return `App ${p[1]}`;
  return null;
}

export const EMBED_PROVIDERS: EmbedProvider[] = [
  // ── Code and packages ───────────────────────────────────────
  { id: "github", label: "GitHub", brand: "#181717", brandDark: "#8B949E", Icon: SiGithub, hosts: ["github.com", "gist.github.com"], detail: githubDetail },
  { id: "gitlab", label: "GitLab", brand: "#FC6D26", Icon: SiGitlab, hosts: ["gitlab.com"] },
  { id: "npm", label: "npm", brand: "#CB3837", Icon: SiNpm, hosts: ["npmjs.com"], detail: npmDetail },
  { id: "pypi", label: "PyPI", brand: "#3775A9", Icon: SiPypi, hosts: ["pypi.org"] },
  { id: "crates", label: "crates.io", brand: "#B7410E", Icon: SiRust, hosts: ["crates.io", "docs.rs"] },
  { id: "docker", label: "Docker Hub", brand: "#2496ED", Icon: SiDocker, hosts: ["hub.docker.com"] },
  { id: "stackoverflow", label: "Stack Overflow", brand: "#F58025", Icon: SiStackoverflow, hosts: ["stackoverflow.com", "superuser.com", "serverfault.com"], hostSuffixes: [".stackexchange.com"] },
  { id: "codepen", label: "CodePen", brand: "#111111", brandDark: "#C9CDD3", Icon: SiCodepen, hosts: ["codepen.io"] },
  { id: "codesandbox", label: "CodeSandbox", brand: "#151515", brandDark: "#B9BEC5", Icon: SiCodesandbox, hosts: ["codesandbox.io"] },
  { id: "stackblitz", label: "StackBlitz", brand: "#1269D3", Icon: SiStackblitz, hosts: ["stackblitz.com"] },
  { id: "replit", label: "Replit", brand: "#F26207", Icon: SiReplit, hosts: ["replit.com"] },
  { id: "vercel", label: "Vercel", brand: "#000000", brandDark: "#B4B4B4", Icon: SiVercel, hosts: ["vercel.com"] },
  { id: "netlify", label: "Netlify", brand: "#00C7B7", Icon: SiNetlify, hosts: ["netlify.com", "netlify.app"] },
  { id: "cloudflare", label: "Cloudflare", brand: "#F38020", Icon: SiCloudflare, hosts: ["cloudflare.com"] },

  // ── Games and mods ──────────────────────────────────────────
  { id: "modrinth", label: "Modrinth", brand: "#00AF5C", Icon: SiModrinth, hosts: ["modrinth.com"], detail: modrinthDetail },
  { id: "curseforge", label: "CurseForge", brand: "#F16436", Icon: SiCurseforge, hosts: ["curseforge.com"] },
  { id: "nexusmods", label: "Nexus Mods", brand: "#D98F40", Icon: SiNexusmods, hosts: ["nexusmods.com"] },
  { id: "steam", label: "Steam", brand: "#1B2838", brandDark: "#8BA5C4", Icon: SiSteam, hosts: ["store.steampowered.com", "steamcommunity.com"], detail: steamDetail },
  { id: "itch", label: "itch.io", brand: "#FA5C5C", Icon: SiItchdotio, hosts: ["itch.io"], hostSuffixes: [".itch.io"] },
  { id: "gog", label: "GOG", brand: "#86328A", Icon: SiGogdotcom, hosts: ["gog.com"] },
  { id: "epic", label: "Epic Games", brand: "#2A2A2A", brandDark: "#B0B0B0", Icon: SiEpicgames, hosts: ["store.epicgames.com", "epicgames.com"] },
  { id: "playstation", label: "PlayStation", brand: "#0070D1", Icon: SiPlaystation, hosts: ["playstation.com", "store.playstation.com"] },
  { id: "nintendo", label: "Nintendo", brand: "#E60012", Icon: SiNintendo, hosts: ["nintendo.com"] },

  // ── Video, music and streams ────────────────────────────────
  { id: "youtube", label: "YouTube", brand: "#FF0000", Icon: SiYoutube, hosts: ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"] },
  { id: "twitch", label: "Twitch", brand: "#9146FF", Icon: SiTwitch, hosts: ["twitch.tv", "clips.twitch.tv"] },
  { id: "vimeo", label: "Vimeo", brand: "#1AB7EA", Icon: SiVimeo, hosts: ["vimeo.com", "player.vimeo.com"] },
  { id: "kick", label: "Kick", brand: "#0FA33C", Icon: SiKick, hosts: ["kick.com"] },
  { id: "rumble", label: "Rumble", brand: "#85C742", Icon: SiRumble, hosts: ["rumble.com"] },
  { id: "spotify", label: "Spotify", brand: "#1DB954", Icon: SiSpotify, hosts: ["open.spotify.com"] },
  { id: "applemusic", label: "Apple Music", brand: "#FA243C", Icon: SiApplemusic, hosts: ["music.apple.com"] },
  { id: "soundcloud", label: "SoundCloud", brand: "#FF5500", Icon: SiSoundcloud, hosts: ["soundcloud.com", "on.soundcloud.com"] },
  { id: "bandcamp", label: "Bandcamp", brand: "#408294", Icon: SiBandcamp, hosts: ["bandcamp.com"], hostSuffixes: [".bandcamp.com"] },
  { id: "tidal", label: "Tidal", brand: "#1A1A1A", brandDark: "#B0B0B0", Icon: SiTidal, hosts: ["tidal.com"] },
  { id: "mixcloud", label: "Mixcloud", brand: "#5000FF", Icon: SiMixcloud, hosts: ["mixcloud.com"] },
  { id: "lastfm", label: "Last.fm", brand: "#D51007", Icon: SiLastdotfm, hosts: ["last.fm"] },

  // ── Social ──────────────────────────────────────────────────
  { id: "x", label: "X", brand: "#0F1419", brandDark: "#C4CDD5", Icon: SiX, hosts: ["x.com", "twitter.com"] },
  { id: "bluesky", label: "Bluesky", brand: "#0285FF", Icon: SiBluesky, hosts: ["bsky.app"] },
  { id: "mastodon", label: "Mastodon", brand: "#6364FF", Icon: SiMastodon, hosts: ["mastodon.social", "mastodon.online", "fosstodon.org"] },
  { id: "reddit", label: "Reddit", brand: "#FF4500", Icon: SiReddit, hosts: ["reddit.com", "old.reddit.com", "redd.it"], detail: redditDetail },
  { id: "facebook", label: "Facebook", brand: "#0866FF", Icon: SiFacebook, hosts: ["facebook.com", "fb.com", "fb.watch", "m.facebook.com"] },
  { id: "instagram", label: "Instagram", brand: "#E4405F", Icon: SiInstagram, hosts: ["instagram.com"] },
  { id: "threads", label: "Threads", brand: "#101010", brandDark: "#BFBFBF", Icon: SiThreads, hosts: ["threads.net", "threads.com"] },
  { id: "tiktok", label: "TikTok", brand: "#EE1D52", Icon: SiTiktok, hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"] },
  { id: "linkedin", label: "LinkedIn", brand: "#0A66C2", Icon: SiLinkedin, hosts: ["linkedin.com"] },
  { id: "pinterest", label: "Pinterest", brand: "#BD081C", Icon: SiPinterest, hosts: ["pinterest.com"], hostSuffixes: [".pinterest.com"] },
  { id: "snapchat", label: "Snapchat", brand: "#B8B400", Icon: SiSnapchat, hosts: ["snapchat.com"] },
  { id: "telegram", label: "Telegram", brand: "#26A5E4", Icon: SiTelegram, hosts: ["t.me", "telegram.me"] },
  { id: "discord", label: "Discord", brand: "#5865F2", Icon: SiDiscord, hosts: ["discord.com", "discord.gg", "discordapp.com"] },

  // ── Reading and reference ───────────────────────────────────
  { id: "wikipedia", label: "Wikipedia", brand: "#3366CC", Icon: SiWikipedia, hosts: ["wikipedia.org"], hostSuffixes: [".wikipedia.org"], detail: wikipediaDetail },
  { id: "mdn", label: "MDN Web Docs", brand: "#1B76C4", Icon: SiMdnwebdocs, hosts: ["developer.mozilla.org"] },
  { id: "hackernews", label: "Hacker News", brand: "#FF6600", Icon: SiYcombinator, hosts: ["news.ycombinator.com"] },
  { id: "medium", label: "Medium", brand: "#1A1A1A", brandDark: "#C0C0C0", Icon: SiMedium, hosts: ["medium.com"], hostSuffixes: [".medium.com"] },
  { id: "devto", label: "DEV", brand: "#3B49DF", Icon: SiDevdotto, hosts: ["dev.to"] },
  { id: "arxiv", label: "arXiv", brand: "#B31B1B", Icon: SiArxiv, hosts: ["arxiv.org"] },
  { id: "archive", label: "Internet Archive", brand: "#4A4A4A", brandDark: "#B5B5B5", Icon: SiInternetarchive, hosts: ["archive.org", "web.archive.org"] },
  { id: "wolfram", label: "Wolfram Alpha", brand: "#DD1100", Icon: SiWolfram, hosts: ["wolframalpha.com"] },
  { id: "goodreads", label: "Goodreads", brand: "#75633F", Icon: SiGoodreads, hosts: ["goodreads.com"] },
  { id: "imdb", label: "IMDb", brand: "#C9A227", Icon: SiImdb, hosts: ["imdb.com"] },
  { id: "letterboxd", label: "Letterboxd", brand: "#00B020", Icon: SiLetterboxd, hosts: ["letterboxd.com"] },

  // ── Images and design ───────────────────────────────────────
  { id: "imgur", label: "Imgur", brand: "#1BB76E", Icon: SiImgur, hosts: ["imgur.com", "i.imgur.com"] },
  { id: "giphy", label: "Giphy", brand: "#FF6666", Icon: SiGiphy, hosts: ["giphy.com"] },
  { id: "flickr", label: "Flickr", brand: "#0063DC", Icon: SiFlickr, hosts: ["flickr.com"] },
  { id: "figma", label: "Figma", brand: "#F24E1E", Icon: SiFigma, hosts: ["figma.com"] },
  { id: "dribbble", label: "Dribbble", brand: "#EA4C89", Icon: SiDribbble, hosts: ["dribbble.com"] },
  { id: "behance", label: "Behance", brand: "#1769FF", Icon: SiBehance, hosts: ["behance.net"] },

  // ── Work ────────────────────────────────────────────────────
  { id: "notion", label: "Notion", brand: "#2F2F2F", brandDark: "#BFBFBF", Icon: SiNotion, hosts: ["notion.so", "notion.site"], hostSuffixes: [".notion.site"] },
  { id: "linear", label: "Linear", brand: "#5E6AD2", Icon: SiLinear, hosts: ["linear.app"] },
  { id: "trello", label: "Trello", brand: "#0052CC", Icon: SiTrello, hosts: ["trello.com"] },
  { id: "jira", label: "Jira", brand: "#0052CC", Icon: SiJira, hosts: ["atlassian.net"], hostSuffixes: [".atlassian.net"] },
  { id: "obsidian", label: "Obsidian", brand: "#7C3AED", Icon: SiObsidian, hosts: ["obsidian.md"] },
  { id: "googledrive", label: "Google Drive", brand: "#1A73E8", Icon: SiGoogledrive, hosts: ["drive.google.com", "docs.google.com", "sheets.google.com", "slides.google.com"] },
  { id: "googlemaps", label: "Google Maps", brand: "#34A853", Icon: SiGooglemaps, hosts: ["maps.google.com", "maps.app.goo.gl", "goo.gl"] },
  { id: "openstreetmap", label: "OpenStreetMap", brand: "#5A8B3E", Icon: SiOpenstreetmap, hosts: ["openstreetmap.org"] },
];

const BY_HOST = new Map<string, EmbedProvider>();
for (const provider of EMBED_PROVIDERS) {
  for (const host of provider.hosts) BY_HOST.set(host, provider);
}

export function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

/** The provider a URL belongs to, or null for the rest of the web. */
export function getEmbedProvider(url: string): EmbedProvider | null {
  let host: string;
  try {
    host = normalizeHost(new URL(url).hostname);
  } catch {
    return null;
  }

  const exact = BY_HOST.get(host);
  if (exact) return exact;

  for (const provider of EMBED_PROVIDERS) {
    if (provider.hostSuffixes?.some((suffix) => host.endsWith(suffix))) return provider;
  }
  return null;
}

/** The line a provider can read out of the path, if it knows how. */
export function getProviderDetail(url: string): string | null {
  const provider = getEmbedProvider(url);
  if (!provider?.detail) return null;
  try {
    return provider.detail(new URL(url));
  } catch {
    return null;
  }
}

/**
 * The accent for a card: the brand where we know it, the colour the page
 * declared where we do not, and the app's own accent when neither is on offer.
 */
export function getAccentColor(
  url: string,
  themeColor: string | null,
  appearance: "light" | "dark",
): string | null {
  const provider = getEmbedProvider(url);
  if (provider) {
    return appearance === "dark" ? provider.brandDark ?? provider.brand : provider.brand;
  }
  return themeColor;
}
