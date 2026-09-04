/* eslint-env node */

import checkExtraResources from "./check-extra-resources.mjs";
import { isSlimBuild } from "./variant.mjs";

// electron-builder accepts one beforeBuild hook. Package the runtime first,
// then retain the existing fail-fast validation for every extra resource.
export default async function beforeBuild() {
  if (isSlimBuild()) {
    // Skipping this is most of why a slim build is quicker. Packaging the
    // runtime is what needs the server, worker and SFU checkouts present.
    console.log("  embedded server: skipped, this is a slim build");
  } else {
    await import("./package-embedded-server.mjs");
  }

  return checkExtraResources();
}
