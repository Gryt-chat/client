import { getGrytConfig } from "../../config";
import { isElectron } from "../electron";

/**
 * Where reports go, and what this build calls itself. **Not configurable**, and
 * **there is no app key** — one shipped in a public app is not a secret (GRYT-529).
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
