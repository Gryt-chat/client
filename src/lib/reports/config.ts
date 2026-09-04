import { getGrytConfig } from "../../config";
import { isElectron } from "../electron";

/**
 * Where reports go, and what this build calls itself.
 *
 * `desktop` and `web` are one codebase and deliberately not one app id — the
 * desktop build can answer things the browser cannot. **Not configurable**: it
 * names which build sent this, so a deployment setting it would be a build
 * lying about what it is.
 *
 * **There is no app key.** One shipped inside a public app is not a secret, and
 * the day it needs rotating is the day everybody who has not updated stops
 * being able to report a bug (GRYT-529).
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
