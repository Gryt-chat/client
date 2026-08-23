import { useMicrophone } from "@gryt/voice";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import {
  comboMouseButton,
  HOTKEY_ACTIONS,
  type HotkeyAction,
  matchesKeyEvent,
  matchesMouseEvent,
  releasesKeyEvent,
  releasesMouseEvent,
} from "../../../../lib/hotkeys";

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
}

/**
 * The trigger half of every hotkey: push to talk, mute, deafen and disconnect.
 *
 * Two transports, and never both at once. In Electron the bindings go to the
 * main process, which watches the whole OS through uiohook and reports back —
 * that is what makes them work while Gryt is in the background. Everywhere
 * else, and on any desktop where uiohook could not start, the window's own key
 * and mouse events do the same job while Gryt has focus.
 *
 * Push to talk only opens and closes the gate here. What that does to the
 * audio graph belongs to @gryt/voice, which is why this hands off to
 * `setPushToTalkActive` rather than touching gain itself.
 */
export function useGlobalHotkeys(onDisconnect?: () => void) {
  const {
    isMuted,
    setIsMuted,
    isDeafened,
    setIsDeafened,
    isServerMuted,
    isServerDeafened,
    inputMode,
    pushToTalkKey,
    muteHotkey,
    deafenHotkey,
    disconnectHotkey,
  } = useSettings();

  // false takes no microphone handle — useMicrophone is a singleton, and this
  // hook only needs the push-to-talk gate on it.
  const { setPushToTalkActive } = useMicrophone(false);

  const [globalCapture, setGlobalCapture] = useState(false);

  // A push-to-talk binding only counts while that input mode is on, otherwise
  // holding the key in voice-activity mode would register a press for nothing.
  const pttBinding = inputMode === "push_to_talk" ? pushToTalkKey : "";

  const bindings: Record<HotkeyAction, string> = {
    ptt: pttBinding,
    mute: muteHotkey,
    deafen: deafenHotkey,
    disconnect: disconnectHotkey,
  };

  // Everything the handlers need, off the dependency list. Without this the
  // IPC subscription would tear down and re-subscribe on every mute toggle,
  // and a key held across that gap would never be released.
  const stateRef = useRef({
    bindings: {} as Record<HotkeyAction, string>,
    isMuted,
    isDeafened,
    isServerMuted,
    isServerDeafened,
    setIsMuted,
    setIsDeafened,
    setPushToTalkActive,
    onDisconnect,
  });
  stateRef.current = {
    bindings,
    isMuted,
    isDeafened,
    isServerMuted,
    isServerDeafened,
    setIsMuted,
    setIsDeafened,
    setPushToTalkActive,
    onDisconnect,
  };

  const pressAction = useCallback((action: HotkeyAction) => {
    const s = stateRef.current;

    // Typing "m" into a message must not toggle mute. Push to talk is exempt —
    // talking while typing is the point of it — and so is a mouse binding,
    // which types nothing.
    if (
      action !== "ptt" &&
      comboMouseButton(s.bindings[action]) === null &&
      isInputFocused()
    ) {
      return;
    }

    switch (action) {
      case "ptt":
        s.setPushToTalkActive(true);
        return;

      case "mute":
        if (s.isServerMuted) {
          toast("You are server muted by an admin.", { icon: "🔇", id: "server-muted" });
          return;
        }
        s.setIsMuted(!s.isMuted);
        return;

      case "deafen":
        if (s.isServerDeafened) {
          toast("You are server deafened by an admin.", { icon: "🔇", id: "server-deafened" });
          return;
        }
        s.setIsDeafened(!s.isDeafened);
        return;

      case "disconnect":
        s.onDisconnect?.();
        return;
    }
  }, []);

  const releaseAction = useCallback((action: HotkeyAction) => {
    if (action === "ptt") stateRef.current.setPushToTalkActive(false);
  }, []);

  useEffect(() => {
    if (!isElectron()) return;

    let cancelled = false;

    getElectronAPI()
      ?.setHotkeys({
        ptt: pttBinding,
        mute: muteHotkey,
        deafen: deafenHotkey,
        disconnect: disconnectHotkey,
      })
      .then((captured) => {
        if (cancelled) return;
        console.log(`[Hotkeys] global capture ${captured ? "on" : "off"}`);
        setGlobalCapture(captured);
      })
      .catch(() => {
        if (!cancelled) setGlobalCapture(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pttBinding, muteHotkey, deafenHotkey, disconnectHotkey]);

  useEffect(() => {
    if (!globalCapture) return;

    const api = getElectronAPI();
    if (!api) return;

    const removeDown = api.onHotkeyDown(pressAction);
    const removeUp = api.onHotkeyUp(releaseAction);

    return () => {
      removeDown();
      removeUp();
    };
  }, [globalCapture, pressAction, releaseAction]);

  useEffect(() => {
    if (globalCapture) return;

    const held = new Set<HotkeyAction>();

    const press = (action: HotkeyAction) => {
      if (held.has(action)) return;
      held.add(action);
      pressAction(action);
    };

    const release = (action: HotkeyAction) => {
      if (!held.delete(action)) return;
      releaseAction(action);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      for (const action of HOTKEY_ACTIONS) {
        if (!matchesKeyEvent(e, stateRef.current.bindings[action])) continue;
        e.preventDefault();
        press(action);
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      for (const action of held) {
        if (releasesKeyEvent(e, stateRef.current.bindings[action])) release(action);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      for (const action of HOTKEY_ACTIONS) {
        if (!matchesMouseEvent(e, stateRef.current.bindings[action])) continue;
        e.preventDefault();
        press(action);
        return;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      for (const action of held) {
        if (releasesMouseEvent(e, stateRef.current.bindings[action])) release(action);
      }
    };

    // Losing focus takes the key events with it, so anything held is released
    // here instead of being stranded open.
    const handleBlur = () => {
      for (const action of [...held]) release(action);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleBlur);
      for (const action of [...held]) release(action);
    };
  }, [
    globalCapture,
    pressAction,
    releaseAction,
    pttBinding,
    muteHotkey,
    deafenHotkey,
    disconnectHotkey,
  ]);
}
