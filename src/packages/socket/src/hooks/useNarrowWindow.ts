import { useEffect, useState } from "react";

import { hasRoomForMemberList, hasRoomForVoicePanel, isTinyWindow } from "../lib/narrowLayout";

/**
 * The window's width, and whether the thing pointing at it is a mouse. The
 * decisions are in `lib/narrowLayout.ts`, so a check can assert them.
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
 * Whether a mouse or trackpad is the pointer — the guard on the tiny window.
 * Watched rather than read once: a keyboard on a tablet changes it.
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
 * Whether the member list fits, given what the voice panel has taken. Pass the
 * width the panel is drawing at, not the width it would like.
 */
export function useRoomForMemberList(voicePanelWidth: number): boolean {
  const windowWidth = useWindowWidth();
  return hasRoomForMemberList({ windowWidth, voicePanelWidth });
}

/**
 * Whether the voice panel fits beside a channel list and a usable chat. Below
 * this the voice view minimizes itself.
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
