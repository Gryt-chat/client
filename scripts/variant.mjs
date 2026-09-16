/* eslint-env node */

/**
 * Which of the two builds this is. `slim` leaves the embedded server out; read
 * from the environment, because three places that never call each other need it.
 */
export function isSlimBuild() {
  return process.env.GRYT_VARIANT === "slim";
}

/** The Mac App Store build. Independent of slim, which it can be as well. */
export function isMasBuild() {
  return process.env.GRYT_MAS === "1";
}

/**
 * What the embedded server's extraResources have in common. One prefix rather
 * than two names, so the config filter and the resource check cannot disagree.
 */
export const EMBEDDED_RESOURCE_PREFIX = "build/embedded-";

/**
 * What the store build ships in place of the archive, and the files it can't start without.
 * Kept in step with MAS_RUNTIME in electron-builder.config.cjs.
 */
export const MAS_RUNTIME_SOURCE = "build/embedded-server";
export const MAS_RUNTIME_PARTS = [
  "versions.json",
  "server/bundle.js",
  "worker/dist/index.js",
  "sfu/mac-arm64/gryt_sfu",
];
