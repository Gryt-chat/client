/**
 * What a window this narrow can still hold.
 *
 * Two answers, both pure, both keyed off the window width, so
 * `check-narrow-layout.mjs` can assert them without a browser and the
 * components can stay about drawing.
 *
 * The measurements below are the real ones, read off the running client at
 * 1400px with everything open: the server rail is 32 and sits inside 16px of
 * page padding on each side, the row puts 16px between panels, and the two
 * sidebars are `SIDEBAR_WIDTH_PX` each. They are constants here rather than
 * measured at runtime because a layout that reflows while it measures itself
 * is a layout that oscillates.
 */

/** `useServerViewLayout`'s numbers, repeated here so this file needs no React. */
const SIDEBAR_WIDTH = 240;
const VOICE_SIDEBAR_WIDTH = 600;
const MIN_CHAT_WIDTH = 200;

/** The rail, the page padding either side of it, and the gaps between panels. */
const RAIL_WIDTH = 32;
const PAGE_PADDING = 16 * 2;
const GAP = 16;

/**
 * What the member panel still costs when it is closed.
 *
 * `SIDEBAR_HOVER_PX`. The panel collapses to a strip you can hover rather than
 * to nothing, and the row still puts a gap in front of it — 24px that has to
 * be paid for even when the list is not there. Leaving it out is what put the
 * chat 11px under its own minimum at 1136.
 */
const MEMBER_STRIP = 8;

/**
 * The width below which both sidebars collapse to their hover strip.
 *
 * This is `useIsCompact`'s 1024 and has to stay in step with it: that hook is
 * what the components actually ask, and this file only explains why the number
 * is what it is.
 */
const COMPACT_MAX_WIDTH = 1024;

/**
 * The width at or below which the window stops being an app and becomes one
 * channel.
 *
 * 520 rather than a rounder number: `useIsMobile` hands over to the phone
 * layout at 768, Electron will not go below 300, and a window somebody has
 * deliberately shrunk into a corner to watch one channel is nearer the bottom
 * of that range than the top. At 520 the chat still holds a readable line —
 * about 60 characters at the default size — and below it the phone layout's
 * own chrome starts costing more than it gives.
 */
const TINY_MAX_WIDTH = 520;

/**
 * Room for the member list, given what else is in the row.
 *
 * The bug this exists for: `useIsCompact` is the window width and nothing
 * else, so with the voice panel open at 600 the row was asked to fit a rail, a
 * channel sidebar, 600, a chat and a member sidebar inside a window that had
 * room for four of those five. The member panel is last and does not shrink,
 * so it went over the right edge instead of getting out of the way.
 *
 * Out of voice the answer is unchanged, which is the point — the behaviour
 * people already know is the one being extended.
 */
export function hasRoomForMemberList({
  windowWidth,
  voicePanelWidth,
}: {
  windowWidth: number;
  /** 0 when the voice view is minimized or the user is not in a call. */
  voicePanelWidth: number;
}): boolean {
  if (voicePanelWidth <= 0) return windowWidth > COMPACT_MAX_WIDTH;

  const needed =
    PAGE_PADDING +
    RAIL_WIDTH +
    GAP +
    SIDEBAR_WIDTH + // channels
    GAP +
    voicePanelWidth +
    MIN_CHAT_WIDTH +
    GAP +
    SIDEBAR_WIDTH; // members

  return windowWidth >= needed;
}

/**
 * The widest the voice panel is allowed to be, before the chat's minimum caps
 * it. Exported so the check script can state the worst case in one place.
 */
export const VOICE_PANEL_WIDTH = VOICE_SIDEBAR_WIDTH;

/**
 * Room for the voice panel at all, next to a channel list and a usable chat.
 *
 * `useVoiceLayout` already clamps the panel to `container - MIN_CHAT_WIDTH`,
 * and that clamp cannot save this on its own: the container is a flex child
 * that grows to hold the panel, so the measurement it reads back is the width
 * the panel already took. Measured at 1030px wide with a call up, the chat was
 * 118px — well under its own minimum — and the row ran past the window edge.
 *
 * So the window is asked first, from the same constants as everything else.
 * Below this the voice view minimizes itself, which is the behaviour the
 * compact breakpoint already had; this only moves the line to where the
 * arithmetic actually falls.
 */
export function hasRoomForVoicePanel(windowWidth: number): boolean {
  const needed =
    PAGE_PADDING +
    RAIL_WIDTH +
    GAP +
    SIDEBAR_WIDTH + // channels
    GAP +
    VOICE_SIDEBAR_WIDTH +
    MIN_CHAT_WIDTH +
    GAP +
    MEMBER_STRIP; // the collapsed member panel is still in the row

  return windowWidth >= needed;
}

/**
 * One channel and nothing else.
 *
 * Deliberately not width alone. A phone in portrait is under any threshold
 * worth picking, and a phone that lost its channel list would have no way back
 * to another channel — the desktop answer is "make the window bigger", which
 * is not an answer there. `pointerFine` is the guard, and it comes from
 * `(pointer: fine)`, which a mouse or a trackpad matches and a finger does
 * not.
 */
export function isTinyWindow({
  windowWidth,
  pointerFine,
}: {
  windowWidth: number;
  pointerFine: boolean;
}): boolean {
  return pointerFine && windowWidth <= TINY_MAX_WIDTH;
}

export { COMPACT_MAX_WIDTH, TINY_MAX_WIDTH };
