/* eslint-env node */

import { fileURLToPath } from "url";

import { buildHelper } from "./build-helper.mjs";
import checkExtraResources from "./check-extra-resources.mjs";
import { HELPER_RESOURCE_PREFIX, isMasBuild, isSlimBuild } from "./variant.mjs";

// electron-builder accepts one beforeBuild hook. Package the runtime first,
// then retain the existing fail-fast validation for every extra resource.
export default async function beforeBuild(context) {
  if (isSlimBuild()) {
    // Skipping this is most of why a slim build is quicker. Packaging the
    // runtime is what needs the server, worker and SFU checkouts present.
    console.log("  embedded server: skipped, this is a slim build");
  } else if (isMasBuild()) {
    // The sandbox won't run what the app unpacks, so the store build ships the tree as it is.
    console.log("  embedded server: not archived, the Mac App Store build ships it unpacked");
  } else {
    await import("./package-embedded-server.mjs");
  }

  // Once per arch. A missing ${arch} resource is skipped silently, so a failed Go build has to stop the build here.
  if (!isMasBuild()) {
    const platform = context?.platform?.nodeName ?? process.platform;
    const arch = context?.arch ?? process.arch;
    console.log(`  gryt-helper: ${buildHelper({ platform, arch, out: fileURLToPath(new URL(`../${HELPER_RESOURCE_PREFIX}${arch}`, import.meta.url)) })}`);
  }

  return checkExtraResources();
}
