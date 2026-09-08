/* eslint-env node */

/**
 * Which of the two builds this is. `slim` leaves the embedded server out; read
 * from the environment, because three places that never call each other need it.
 */
export function isSlimBuild() {
  return process.env.GRYT_VARIANT === "slim";
}

/**
 * What the embedded server's extraResources have in common. One prefix rather
 * than two names, so the config filter and the resource check cannot disagree.
 */
export const EMBEDDED_RESOURCE_PREFIX = "build/embedded-";
