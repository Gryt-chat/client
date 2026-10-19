import { IS_BETA_BUILD } from "@/common";

import { isElectron } from "../../../../lib/electron";
import { describeThisDevice } from "../../../../lib/pairing/device";

/** What this install calls itself in its device certificate, so a list of devices can be told
    apart: "Gryt beta on Windows PC", "Chrome on macOS" (GRYT-1764). At most 64 bytes. */
export function thisDeviceCertificateName(userAgent = navigator.userAgent, desktop = isElectron()): string {
  const d = describeThisDevice(userAgent, desktop);
  const beta = IS_BETA_BUILD ? " beta" : "";
  const build = import.meta.env?.DEV ? " dev build" : beta;
  const inBrowser = build ? `Gryt${build} in ${d.name} on ${d.platform}` : `${d.name} on ${d.platform}`;
  const name = desktop ? `Gryt${build} on ${d.name}` : inBrowser;
  return new TextEncoder().encode(name).length <= 64 ? name : name.slice(0, 60);
}
