import { isElectron } from "./electron";

/**
 * A pre-filled link to the bug report form.
 *
 * A report without a version and a platform usually costs a round trip before
 * it can be looked at, and the app already knows both. GitHub issue forms take
 * initial values as query parameters keyed by field id, so these land in the
 * right boxes rather than being pasted into the description.
 *
 * Everything else the form asks for is a judgement only the person reporting
 * can make, so nothing else is guessed at.
 */
const NEW_ISSUE_URL = "https://github.com/Gryt-chat/client/issues/new";

/** Best effort, from the user agent. Wrong beats absent here. */
function readPlatform(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown OS";

  return `${os}, ${isElectron() ? "desktop app" : "browser"}`;
}

export function bugReportUrl(): string {
  const params = new URLSearchParams({
    template: "bug_report.yml",
    version: __APP_VERSION__,
    platform: readPlatform()
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}
