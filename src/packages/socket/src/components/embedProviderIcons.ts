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
 * A logo for each site `@gryt/core` knows by name.
 *
 * The hostnames, the brand colours and the path rules live in the package,
 * because the phone needs all three and was carrying its own copy of them. The
 * artwork cannot go with them: a logo is a React component here and an SVG path
 * or a favicon there, and the package compiles without a DOM on purpose.
 *
 * So this is what stays app-side, keyed by the provider `id`. A provider with
 * no entry falls back to the site's own favicon, which is what every site
 * outside the list gets anyway — so adding a provider to the package without
 * adding a logo here degrades rather than breaks.
 */
export const PROVIDER_ICONS: Record<string, IconType> = {
  github: SiGithub,
  gitlab: SiGitlab,
  npm: SiNpm,
  pypi: SiPypi,
  crates: SiRust,
  docker: SiDocker,
  stackoverflow: SiStackoverflow,
  codepen: SiCodepen,
  codesandbox: SiCodesandbox,
  stackblitz: SiStackblitz,
  replit: SiReplit,
  vercel: SiVercel,
  netlify: SiNetlify,
  cloudflare: SiCloudflare,

  modrinth: SiModrinth,
  curseforge: SiCurseforge,
  nexusmods: SiNexusmods,
  steam: SiSteam,
  itch: SiItchdotio,
  gog: SiGogdotcom,
  epic: SiEpicgames,
  playstation: SiPlaystation,
  nintendo: SiNintendo,

  youtube: SiYoutube,
  twitch: SiTwitch,
  vimeo: SiVimeo,
  kick: SiKick,
  rumble: SiRumble,
  spotify: SiSpotify,
  applemusic: SiApplemusic,
  soundcloud: SiSoundcloud,
  bandcamp: SiBandcamp,
  tidal: SiTidal,
  mixcloud: SiMixcloud,
  lastfm: SiLastdotfm,

  x: SiX,
  bluesky: SiBluesky,
  mastodon: SiMastodon,
  reddit: SiReddit,
  facebook: SiFacebook,
  instagram: SiInstagram,
  threads: SiThreads,
  tiktok: SiTiktok,
  linkedin: SiLinkedin,
  pinterest: SiPinterest,
  snapchat: SiSnapchat,
  telegram: SiTelegram,
  discord: SiDiscord,

  wikipedia: SiWikipedia,
  mdn: SiMdnwebdocs,
  hackernews: SiYcombinator,
  medium: SiMedium,
  devto: SiDevdotto,
  arxiv: SiArxiv,
  archive: SiInternetarchive,
  wolfram: SiWolfram,
  goodreads: SiGoodreads,
  imdb: SiImdb,
  letterboxd: SiLetterboxd,

  imgur: SiImgur,
  giphy: SiGiphy,
  flickr: SiFlickr,
  figma: SiFigma,
  dribbble: SiDribbble,
  behance: SiBehance,

  notion: SiNotion,
  linear: SiLinear,
  trello: SiTrello,
  jira: SiJira,
  obsidian: SiObsidian,
  googledrive: SiGoogledrive,
  googlemaps: SiGooglemaps,
  openstreetmap: SiOpenstreetmap,
};
