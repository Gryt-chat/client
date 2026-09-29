/** What's playing, read from the OS media controls (GRYT-1637), for a "Listening to" card.
    Windows reads its media session, Linux MPRIS, and macOS asks Spotify and Music directly. */

import { execFile } from "child_process";

export interface NowPlaying {
  /** The player, as a key for asking once: `app:spotify`. */
  key: string;
  /** The player's name, like Spotify. */
  player: string;
  title: string;
  artist?: string;
  album?: string;
}

function run(command: string, args: string[], timeout = 4_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true, maxBuffer: 256 * 1024 }, (err, stdout) =>
      resolve(err ? "" : stdout),
    );
  });
}

const clean = (value: unknown, max = 128): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = [...value].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c)).join("").trim().slice(0, max);
  return text || undefined;
};

/** A player name as a key: `Spotify.exe` and `org.mpris.MediaPlayer2.spotify` both become `app:spotify`. */
export function playerKey(raw: string): string {
  const base = raw
    .replace(/^org\.mpris\.MediaPlayer2\./i, "")
    .replace(/\.instance[\w.]*$/i, "")
    .replace(/!.*$/, "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.exe$/i, "")
    .toLowerCase();
  const known: Record<string, string> = {
    "spotifyab.spotifymusic_zpdnekdrzrea0": "spotify",
    "appleinc.applemusicwin_nzyj5cx40ttqa": "music",
    chromium: "chrome",
    "google-chrome": "chrome",
  };
  const name = (known[base] ?? base).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `app:${name || "player"}`;
}

const PLAYER_NAMES: Record<string, string> = {
  "app:spotify": "Spotify",
  "app:music": "Apple Music",
  "app:chrome": "Chrome",
  "app:firefox": "Firefox",
  "app:msedge": "Edge",
  "app:vlc": "VLC",
  "app:tidal": "TIDAL",
  "app:deezer": "Deezer",
};

export function playerName(key: string, fallback?: string): string {
  return PLAYER_NAMES[key] ?? clean(fallback, 40) ?? key.replace(/^app:/, "");
}

/* ── Windows: the media session every player with media controls reports to ── */

const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$s = $mgr.GetCurrentSession()
if ($s) {
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  [pscustomobject]@{ app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; status = [string]$s.GetPlaybackInfo().PlaybackStatus } | ConvertTo-Json -Compress
}
`;

/** One line of JSON from the script above; only a session that is playing counts. */
export function parseWindows(stdout: string): NowPlaying | null {
  try {
    const raw = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (raw.status !== "Playing") return null;
    const title = clean(raw.title);
    const app = clean(raw.app, 200);
    if (!title || !app) return null;
    const key = playerKey(app);
    return { key, player: playerName(key, app), title, artist: clean(raw.artist), album: clean(raw.album) };
  } catch {
    return null;
  }
}

async function readWindows(): Promise<NowPlaying | null> {
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT], 8_000);
  return out ? parseWindows(out) : null;
}

/* ── Linux: MPRIS over the session bus ───────────────────────────────── */

/** The player names on the bus, from `gdbus call ... ListNames`. */
export function parseMprisNames(stdout: string): string[] {
  return [...stdout.matchAll(/'(org\.mpris\.MediaPlayer2\.[^']+)'/g)].map((m) => m[1]);
}

/** `gdbus call ... GetAll org.mpris.MediaPlayer2.Player`, read with regexes since it's GVariant text. */
export function parseMprisPlayer(name: string, stdout: string): NowPlaying | null {
  if (!/'PlaybackStatus': <'Playing'>/.test(stdout)) return null;
  const pick = (field: string) => stdout.match(new RegExp(`'${field}': <(?:\\[)?'((?:[^'\\\\]|\\\\.)*)'`))?.[1];
  const title = clean(pick("xesam:title"));
  if (!title) return null;
  const key = playerKey(name);
  return { key, player: playerName(key, name.replace(/^org\.mpris\.MediaPlayer2\./, "")), title, artist: clean(pick("xesam:artist")), album: clean(pick("xesam:album")) };
}

async function readLinux(): Promise<NowPlaying | null> {
  const names = parseMprisNames(
    await run("gdbus", ["call", "--session", "--dest", "org.freedesktop.DBus", "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.ListNames"]),
  );
  for (const name of names) {
    const out = await run("gdbus", ["call", "--session", "--dest", name, "--object-path", "/org/mpris/MediaPlayer2", "--method", "org.freedesktop.DBus.Properties.GetAll", "org.mpris.MediaPlayer2.Player"]);
    const found = parseMprisPlayer(name, out);
    if (found) return found;
  }
  return null;
}

/* ── macOS: Spotify and Music, asked directly, only while they're running ── */

/*
 * macOS keeps its system-wide Now Playing to Apple's own apps, so Gryt asks the two
 * players people use. The first time, macOS asks whether Gryt may talk to them.
 */
const MAC_PLAYERS: { app: string; key: string }[] = [
  { app: "Spotify", key: "app:spotify" },
  { app: "Music", key: "app:music" },
];

const macScript = (app: string) => `
if application "${app}" is running then
  tell application "${app}"
    if player state is playing then
      return (name of current track) & (character id 31) & (artist of current track) & (character id 31) & (album of current track)
    end if
  end tell
end if
return ""`;

export function parseMac(key: string, stdout: string): NowPlaying | null {
  const [title, artist, album] = stdout.trim().split("\u001f");
  const t = clean(title);
  if (!t) return null;
  return { key, player: playerName(key), title: t, artist: clean(artist), album: clean(album) };
}

async function readMac(running: readonly string[]): Promise<NowPlaying | null> {
  for (const { app, key } of MAC_PLAYERS) {
    // Checked against the process list first, so asking never launches a player that's closed.
    if (!running.some((p) => p.includes(`/${app}.app/`))) continue;
    const found = parseMac(key, await run("osascript", ["-e", macScript(app)]));
    if (found) return found;
  }
  return null;
}

/** What's playing right now, or null. `running` is the process list the detector already has. */
export async function readNowPlaying(running: readonly string[] = []): Promise<NowPlaying | null> {
  if (process.platform === "win32") return readWindows();
  if (process.platform === "linux") return readLinux();
  if (process.platform === "darwin") return readMac(running);
  return null;
}
