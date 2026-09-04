/**
 * The rose a beta build wears.
 *
 * Deliberately far from the brand violet rather than a tint of it — the point
 * is that you can tell which build you are looking at without reading anything.
 * Was an amber, #f2a33c, which read as yellow rather than as a chosen colour.
 */

export const BETA_ACCENT = "#753A4B";

/**
 * The other two steps the mark is drawn in: the face above the body, the wings
 * below it.
 *
 * The bird is three tones, not one. Tinting only the body left a beta build
 * wearing a tinted owl with a violet face and violet wings.
 *
 * The deep tone doubles as the ink: the eyes, the beak and the wink are drawn
 * in it. On the stable mark those are the ground's own colour, which works
 * because the ground is dark. It is not here.
 */
export const BETA_ACCENT_SOFT = "#EECAB9";
export const BETA_ACCENT_DEEP = "#5F2F41";

/**
 * The ground a beta build's mark sits on.
 *
 * The stable mark keeps a dark ground and lets the bird carry the colour, and
 * the note in logo.tsx said tinting the ground "would only darken a dark
 * square". That holds for a darker tint and not for this one: the rose is
 * lighter than the bird, so figure and ground swap over.
 */
export const BETA_GROUND = "#CE7072";

/**
 * Is the build that is currently running a beta?
 *
 * The version decides, not the channel preference. Someone can be subscribed to
 * beta while still running the stable build they last installed.
 *
 * __APP_VERSION__ is a compile-time define fed from packages/client's
 * package.json (vite.config.ts), so it is the version of this exact bundle and
 * it exists in every build. This used to ask Electron for the version and mark
 * nothing when there was no Electron, which left the hosted client at
 * beta.gryt.chat wearing no mark while its own About panel printed a -beta
 * version.
 */
export const IS_BETA_BUILD = /-beta/i.test(__APP_VERSION__);

export function useIsBetaBuild(): boolean {
  return IS_BETA_BUILD;
}

