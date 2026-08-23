/**
 * What "include audio" on a screen share actually picks up, which is not the
 * same thing on every platform or for every source.
 *
 * Windows captures per process: a window share carries only that application's
 * audio, and a whole-screen share carries everything except Gryt. That
 * difference is the answer to a real complaint — sharing a game while sitting
 * in another app's voice chat sends that app's audio back out, and the people
 * in it hear themselves — so the picker says which one you are about to do.
 *
 * macOS captures the machine either way: the capture helper there is
 * ScreenCaptureKit with `excludesCurrentProcessAudio`, and it ignores the
 * source it is handed. Per-application capture is GRYT-564.
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
