import { getGrytConfig } from "../../config";
import { isElectron } from "../electron";

/**
 * Where reports go, and what this build calls itself.
 *
 * ## The app id
 *
 * `desktop` and `web` are the same codebase and deliberately not the same app
 * id. The service keys them separately so a key pulled out of one is one client
 * to reship rather than all of them, and the two are worth telling apart when
 * reading the inbox anyway — the desktop build can answer things the browser
 * cannot, and a report with none of them is a different report.
 *
 * Not configurable. It names which build sent this, so a deployment setting it
 * would be a build lying about what it is.
 *
 * ## There is no key
 *
 * There was an `X-Gryt-App-Key` here, a shared secret shipped inside the app.
 * GRYT-529 took it out at the service: a key that ships inside a public app is
 * not a secret, and the day it needs rotating is the day everybody who has not
 * updated stops being able to report a bug.
 *
 * What keeps the junk out is on the service side — a minimum gap between
 * requests, counters per address and per install, the ban list, and a triage
 * pass that bans whoever keeps sending noise. What identifies a reporter is the
 * assertion in `assertion.ts`, which cannot be lifted out of a bundle.
 */

export interface ReportsConfig {
  url: string;
  /** The `X-Gryt-App` id. Must match a key entry on the service. */
  app: "desktop" | "web";
}

export function reportsConfig(): ReportsConfig {
  const config = getGrytConfig();
  return {
    url: config.GRYT_REPORTS_URL.replace(/\/+$/, ""),
    app: isElectron() ? "desktop" : "web",
  };
}
