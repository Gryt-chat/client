/**
 * Which of the two builds this is. `slim` leaves the embedded server out; read
 * from the environment, because three places that never call each other need it.
 */
export function isSlimBuild(): boolean {
  return process.env.GRYT_VARIANT === "slim";
}

/** The Mac App Store build. Independent of slim, which it can be as well. */
export function isMasBuild(): boolean {
  return process.env.GRYT_MAS === "1";
}

/**
 * What the embedded server's extraResources have in common. One prefix rather
 * than two names, so the config filter and the resource check cannot disagree.
 */
export const EMBEDDED_RESOURCE_PREFIX = "build/embedded-";

/** Where the beforeBuild hook puts the helper, per arch. */
export const HELPER_RESOURCE_PREFIX = "build/helper/";
/** And gryt-voice, the native voice engine's process (GRYT-1837). */
export const VOICE_RESOURCE_PREFIX = "build/voice/";

/**
 * What the store build ships in place of the archive, and the files it can't start without.
 */
export const MAS_RUNTIME_SOURCE = "build/embedded-server";
export const MAS_RUNTIME_PARTS = [
  "versions.json",
  "server/bundle.js",
  "worker/dist/index.js",
  "sfu/mac-arm64/gryt_sfu",
];
