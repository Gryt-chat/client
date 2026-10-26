/** The picker's footer. Only Windows captures per process, and only for a window rather than a screen. */
export function shareSoundHint(platform: string, picksScreen: boolean): string {
  const lead = "Click more than one to share several windows. Each picked window sets its own quality and sound";
  if (platform === "win32" && !picksScreen) return `${lead}, and sound only ever comes from the windows you pick.`;
  return `${lead}. Sound comes from everything playing on this computer except Gryt.`;
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

/**
 * The audio stream id a screen share announces. Empty once capture has stopped, even mid-share.
 * The first stream's id wins after that, since replaceTrack leaves the transceiver's msid on it.
 */
export function screenAudioStreamId(
  shareActive: boolean,
  audioStream: { id: string } | null | undefined,
  transceiverStreamId: string | null,
): string {
  if (!shareActive || !audioStream) return "";
  return transceiverStreamId || audioStream.id;
}

/** The platform, as coarsely as the user agent states it. */
export function currentPlatform(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/.test(ua)) return "win32";
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Linux|X11/.test(ua)) return "linux";
  return "";
}
