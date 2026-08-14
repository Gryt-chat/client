/* eslint-env node */

import checkExtraResources from "./check-extra-resources.mjs";

// electron-builder accepts one beforeBuild hook. Package the runtime first,
// then retain the existing fail-fast validation for every extra resource.
export default async function beforeBuild() {
  await import("./package-embedded-server.mjs");
  return checkExtraResources();
}
