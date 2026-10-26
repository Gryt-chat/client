import { useEffect, useRef } from "react";

import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";
import { useDirectory } from "@/socket/src/hooks/dmDirectory";
import { requestConversation, setDmSpaceOpen } from "@/socket/src/hooks/dmSpace";

/** The rail asking the voice view's own camera or share button to act, once the view is open. */
export type CallButton = "camera" | "share";

const PRESS_EVENT = "gryt:press-call-button";
/** Long enough for the view to open, short enough that a stale press never fires later. */
const PRESS_TTL_MS = 3000;
/** The view's open spring; pressing earlier anchors the popup to a panel still opening. */
const OPEN_MS = 400;

let pending: { button: CallButton; at: number } | null = null;

export function pressCallButton(button: CallButton): void {
  pending = { button, at: Date.now() };
  window.dispatchEvent(new CustomEvent(PRESS_EVENT, { detail: button }));
}

/** Any press at all: the voice view opens at preset 1 for it. */
export function useAnyCallButtonPress(onPress: () => void): void {
  const ref = useRef(onPress);
  ref.current = onPress;
  useEffect(() => {
    const on = () => ref.current();
    window.addEventListener(PRESS_EVENT, on);
    return () => window.removeEventListener(PRESS_EVENT, on);
  }, []);
}

/** The bar's button for `button` takes the press, including one made before it mounted. */
export function useCallButtonPress(button: CallButton, act: () => void, enabled = true): void {
  const ref = useRef(act);
  ref.current = act;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const take = () => {
      if (pending?.button !== button || Date.now() - pending.at > PRESS_TTL_MS) return;
      pending = null;
      timer = setTimeout(() => ref.current(), OPEN_MS);
    };
    take();
    window.addEventListener(PRESS_EVENT, take);
    return () => {
      window.removeEventListener(PRESS_EVENT, take);
      clearTimeout(timer);
    };
  }, [button, enabled]);
}

/** Back to the call's server or conversation, with the voice view open. */
export function useBackToCall() {
  const directory = useDirectory();
  const { switchToServer, viewServerBehindDmSpace } = useServerManagement();
  const { setShowVoiceView } = useSettings();
  return (host: string, channelId: string) => {
    if (directory.some((e) => e.host === host && e.conversation.conversation_id === channelId)) {
      requestConversation(host, channelId);
      viewServerBehindDmSpace(host);
      setDmSpaceOpen(true);
    } else {
      switchToServer(host);
    }
    setShowVoiceView(true);
  };
}

/**
 * The top of the rail's call capsule: whose call this is, as a circle with the
 * call's green ring. Hovering says where it is and offers the way back to it.
 */
