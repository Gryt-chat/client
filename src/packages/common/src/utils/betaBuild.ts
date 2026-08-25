/**
 * The amber a beta build wears.
 *
 * Deliberately far from the brand violet rather than a tint of it — the point
 * is that you can tell which build you are looking at without reading anything.
 * Kept in step by hand with the same value in electron/splash.html, which
 * cannot import from here.
 */

export const BETA_ACCENT = "#f2a33c";

/**
 * The other two steps the mark is drawn in: the face above the body, the wings
 * below it.
 *
 * The bird is three tones, not one. Tinting only the body left a beta build
 * wearing an amber owl with a violet face and violet wings, which reads as
 * three colours arguing rather than as one owl in another colour.
 *
 * Both are the same ratio off the amber that #B5A8E6 and #7C6EC3 are off
 * #A495E3, so the bird keeps its own modelling. Kept in step by hand with
 * --owl-face and --owl-wing in electron/splash.html, which cannot import from
 * here.
 */
export const BETA_ACCENT_SOFT = "#ffc46b";
export const BETA_ACCENT_DEEP = "#b77834";

/**
 * Is the build that is currently running a beta?
 *
 * The version decides, not the channel preference. Someone can be subscribed to
 * beta while still running the stable build they last installed, and the mark
 * should describe what is actually open.
 *
 * __APP_VERSION__ is a compile-time define fed from packages/client's
 * package.json (vite.config.ts), so it is the version of this exact bundle and
 * it exists in every build. That matters: this used to ask Electron for the
 * version and mark nothing when there was no Electron, which left the hosted
 * client at beta.gryt.chat wearing no mark at all while its own About panel
 * printed a -beta version. It is a beta, so it should say so.
 */
export const IS_BETA_BUILD = /-beta/i.test(__APP_VERSION__);

export function useIsBetaBuild(): boolean {
  return IS_BETA_BUILD;
}

