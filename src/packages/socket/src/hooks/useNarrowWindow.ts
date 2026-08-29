import { useEffect, useState } from "react";

import { hasRoomForMemberList, hasRoomForVoicePanel, isTinyWindow } from "../lib/narrowLayout";

/**
 * The window's width, and whether the thing pointing at it is a mouse.
 *
 * `useIsCompact` in the mobile package answers a width question and nothing
 * else, which is the right shape for what it does. These two need more: one
 * has to know how much of the row the voice panel has taken, and the other has
 * to know it is not on a phone. The decisions themselves are in
 * `lib/narrowLayout.ts`, so `check-narrow-layout.mjs` can assert them without
 * a browser.
 */
function useWindowWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/**
 * Whether a mouse or trackpad is the pointer.
 *
 * The guard on the tiny window. A phone in portrait is narrower than any
 * threshold worth picking, and a phone that lost its channel list would have no
 * way back to another channel — "make the window bigger" is not an answer
 * there. Watched rather than read once: a tablet with a keyboard attached and
 * removed changes this without a reload.
 */
function usePointerFine() {
  const [fine, setFine] = useState(
    () => window.matchMedia?.("(pointer: fine)").matches ?? true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: fine)");
    if (!mq) return;
    const onChange = () => setFine(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return fine;
}

/**
 * Whether the member list fits, given what the voice panel has taken.
 *
 * Pass the width the panel is actually drawing at — 0 when it is minimized or
 * there is no call — not the width it would like.
 */
export function useRoomForMemberList(voicePanelWidth: number): boolean {
  const windowWidth = useWindowWidth();
  return hasRoomForMemberList({ windowWidth, voicePanelWidth });
}

/**
 * Whether the voice panel fits beside a channel list and a usable chat.
 *
 * Below this the voice view minimizes itself, the same way it does at the
 * compact breakpoint.
 */
export function useRoomForVoicePanel(): boolean {
  return hasRoomForVoicePanel(useWindowWidth());
}

/** One channel and nothing else. Desktop only; see `usePointerFine`. */
export function useIsTinyWindow(): boolean {
  const windowWidth = useWindowWidth();
  const pointerFine = usePointerFine();
  return isTinyWindow({ windowWidth, pointerFine });
}
