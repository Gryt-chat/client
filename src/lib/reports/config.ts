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
 * ## The key
 *
 * `X-Gryt-App-Key` is a shared secret shipped inside the app, and the service
 * is blunt that this is friction rather than authentication: anyone can pull it
 * out of a bundle or read one request in a proxy. What it buys is that a
 * scanner finding an open POST endpoint cannot fill the table overnight.
 *
 * The thing that authenticates is the assertion in `assertion.ts`.
 *
 * Empty is a working state, not a broken one. The service allows unkeyed
 * submissions when it has no keys configured, which is how it runs on a laptop,
 * and the header is simply left off. Against a deployment that does have keys,
 * an empty one is refused — which is the right way round: a missing key should
 * fail against production and not against a dev box.
 */

export interface ReportsConfig {
  url: string;
  /** The `X-Gryt-App` id. Must match a key entry on the service. */
  app: "desktop" | "web";
  /** Empty until a build or a container sets one. See above. */
  appKey: string;
}

export function reportsConfig(): ReportsConfig {
  const config = getGrytConfig();
  return {
    url: config.GRYT_REPORTS_URL.replace(/\/+$/, ""),
    app: isElectron() ? "desktop" : "web",
    appKey: config.GRYT_REPORTS_APP_KEY,
  };
}
