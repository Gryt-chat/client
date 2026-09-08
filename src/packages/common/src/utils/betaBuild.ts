/**
 * The rose a beta build wears. Deliberately far from the brand violet rather than
 * a tint of it, so you can tell which build you are looking at.
 */

export const BETA_ACCENT = "#753A4B";

/**
 * The other two steps the mark is drawn in: the face above the body, the wings
 * below. The deep tone doubles as the ink for the eyes, beak and wink.
 */
export const BETA_ACCENT_SOFT = "#EECAB9";
export const BETA_ACCENT_DEEP = "#5F2F41";

/**
 * The ground a beta build's mark sits on. The stable mark keeps a dark ground;
 * the rose is lighter than the bird, so figure and ground swap over.
 */
export const BETA_GROUND = "#CE7072";

/**
 * Is the build currently running a beta? The version decides, not the channel
 * preference — __APP_VERSION__ is this bundle's, and exists in every build.
 */
export const IS_BETA_BUILD = /-beta/i.test(__APP_VERSION__);

export function useIsBetaBuild(): boolean {
  return IS_BETA_BUILD;
}

