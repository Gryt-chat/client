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

/** Mirrors CaptureProblem in electron/captureHealth.ts. */
export type ScreenAudioProblem = "permission" | "failed" | "no-audio";

/** What to tell somebody whose share is going out without its sound. */
export function screenAudioProblemMessage(problem: string): string | null {
  switch (problem) {
    case "permission":
      return "Your screen share has no sound. macOS hasn't let Gryt record the screen. Turn on Gryt Chat in System Settings > Privacy & Security > Screen & System Audio Recording, then share again.";
    case "failed":
      return "Your screen share has no sound. Gryt couldn't record it. Try sharing again.";
    case "no-audio":
      return "Your screen share has no sound. Gryt isn't getting any audio from macOS, so people only see your screen. Try sharing again.";
    default:
      return null;
  }
}

/** The platform, as coarsely as the user agent states it. */
export function currentPlatform(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/.test(ua)) return "win32";
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Linux|X11/.test(ua)) return "linux";
  return "";
}
