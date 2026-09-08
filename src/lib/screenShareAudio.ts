/**
 * What "include audio" picks up, which differs by platform and source. Windows
 * captures per process; macOS captures the machine either way (GRYT-564).
 */
export function audioScopeHint(platform: string, sourceId: string | null): string {
  const isWindows = platform === "win32";
  const isWindowSource = sourceId?.startsWith("window:") ?? false;

  if (isWindows && isWindowSource) {
    return "Shares this window's audio only. Anything else playing stays out of it.";
  }

  if (isWindows) {
    return "Shares every sound on this machine except Gryt, including any other voice app you are in. Pick a single window to send just that app.";
  }

  return "Shares every sound on this machine except Gryt, including any other voice app you are in.";
}

/** The platform, as coarsely as the user agent states it. */
export function currentPlatform(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/.test(ua)) return "win32";
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Linux|X11/.test(ua)) return "linux";
  return "";
}
