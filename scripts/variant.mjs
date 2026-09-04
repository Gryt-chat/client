/* eslint-env node */

/**
 * Which of the two builds this is.
 *
 * `slim` leaves the embedded server out — the tar.gz and the native overlay,
 * about 72MB unpacked and 34MB off the Windows installer. Everything else is
 * identical, so this is not a feature flag in the app: the slim build simply
 * has no runtime to find, and `isEmbeddedServerAvailable()` already reports
 * that correctly because it checks the files rather than a setting.
 *
 * Read from the environment rather than passed around, because it has to reach
 * three places that do not call each other: this hook, the resource check, and
 * electron-builder.config.cjs. That file is CommonJS and cannot import this
 * one, so it repeats the same one-line check.
 */
export function isSlimBuild() {
  return process.env.GRYT_VARIANT === "slim";
}

/**
 * What the embedded server's extraResources have in common.
 *
 * Both `build/embedded-server.tar.gz` and `build/embedded-native/` start with
 * this, and nothing else in extraResources does. One prefix rather than two
 * names so the config filter and the resource check cannot disagree about
 * which entries a slim build leaves out.
 */
export const EMBEDDED_RESOURCE_PREFIX = "build/embedded-";
