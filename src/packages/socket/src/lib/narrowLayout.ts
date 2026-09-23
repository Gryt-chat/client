/**
 * What a window this narrow can still hold. Pure, so `check-narrow-layout.mjs` can
 * assert it. The measurements are constants: a self-measuring layout oscillates.
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
 * What the member panel still costs when it is closed: it collapses to a hover
 * strip, and the row keeps a 24px gap. Leaving it out put the chat 11px under.
 */
const MEMBER_STRIP = 8;

/**
 * The width below which both sidebars collapse to their hover strip. This is
 * `useIsCompact`'s 1024 and has to stay in step with it.
 */
const COMPACT_MAX_WIDTH = 1024;

/**
 * The width at or below which the window stops being an app and becomes one
 * channel. At 520 the chat still holds about 60 characters at the default size.
 */
const TINY_MAX_WIDTH = 520;

/**
 * The thread panel's width when it sits beside the conversation. Over it, it is
 * `min(380px, 100%)` instead, because there is nothing to share with.
 */
export const THREAD_PANEL_WIDTH = 380;

/**
 * What the conversation keeps beside an open thread: 440px of pane, measured at
 * about 45 characters a line. `TINY_MAX_WIDTH`'s 520 draws about 57.
 */
const MIN_CHAT_BESIDE_THREAD = 440;

/**
 * Room for the member list, given what else is in the row. `useIsCompact` is the
 * window width alone, so the voice panel pushed the member panel off the edge.
 */
export function hasRoomForMemberList({
  windowWidth,
  voicePanelWidth,
  threadPanelWidth = 0,
}: {
  windowWidth: number;
  /** 0 when the voice view is minimized or the user is not in a call. */
  voicePanelWidth: number;
  /** 0 unless a thread is drawn beside the conversation rather than over it. */
  threadPanelWidth?: number;
}): boolean {
  if (voicePanelWidth <= 0 && threadPanelWidth <= 0) return windowWidth > COMPACT_MAX_WIDTH;

  /* The thread panel takes its room out of the conversation, so what is left has
     to stay readable rather than only stay a chat. */
  const chat = threadPanelWidth > 0 ? MIN_CHAT_BESIDE_THREAD : MIN_CHAT_WIDTH;

  const needed =
    PAGE_PADDING +
    RAIL_WIDTH +
    GAP +
    SIDEBAR_WIDTH + // channels
    (voicePanelWidth > 0 ? GAP + voicePanelWidth : 0) +
    (threadPanelWidth > 0 ? GAP : 0) +
    chat +
    threadPanelWidth +
    GAP +
    SIDEBAR_WIDTH; // members

  return windowWidth >= needed;
}

/**
 * Whether the thread fits beside the conversation instead of over it. Below this
 * it takes the whole chat pane, which is a screen rather than a covered one.
 */
export function hasRoomForThreadBeside({
  windowWidth,
  voicePanelWidth,
}: {
  windowWidth: number;
  /** 0 when the voice view is minimized or the user is not in a call. */
  voicePanelWidth: number;
}): boolean {
  const needed =
    PAGE_PADDING +
    RAIL_WIDTH +
    GAP +
    SIDEBAR_WIDTH + // channels
    (voicePanelWidth > 0 ? GAP + voicePanelWidth : 0) +
    GAP +
    MIN_CHAT_BESIDE_THREAD +
    THREAD_PANEL_WIDTH +
    MEMBER_STRIP; // the collapsed member panel is still in the row

  return windowWidth >= needed;
}

/**
 * The widest the voice panel is allowed to be, before the chat's minimum caps
 * it. Exported so the check script can state the worst case in one place.
 */
export const VOICE_PANEL_WIDTH = VOICE_SIDEBAR_WIDTH;

/**
 * Room for the voice panel at all, next to a channel list and a usable chat.
 * `useVoiceLayout`'s clamp cannot save it: it measures a container the panel grew.
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
 * One channel and nothing else. Not width alone — a phone that lost its channel
 * list has no way back, so `pointerFine` guards it.
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

/** The server settings dialog's 2rem margins, 21px padding, 200px tab rail and its gap. */
export const SERVER_SETTINGS_CHROME = 64 + 42 + 200 + 16;
/** User settings: 1.5rem margins, 21px padding, a 220px rail and its gap. */
export const USER_SETTINGS_CHROME = 48 + 42 + 220 + 16;
const MIN_SETTINGS_CONTENT = 400;

/** Whether a settings dialog's tabs fit as a rail beside the page. Below this they are a picker. */
export function hasRoomForSettingsRail(windowWidth: number, chrome: number): boolean {
  return windowWidth - chrome >= MIN_SETTINGS_CONTENT;
}
