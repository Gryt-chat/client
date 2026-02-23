import { useEffect, useRef } from "react";

import { useSettings } from "@/settings";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import { MicrophoneBufferType } from "../types/Microphone";

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
}

function matchesPttKey(e: KeyboardEvent, pttKey: string): boolean {
  if (!pttKey) return false;
  const parts = pttKey.split("+");
  const key = parts[parts.length - 1];
  const needsCtrl = parts.includes("Ctrl");
  const needsShift = parts.includes("Shift");
  const needsAlt = parts.includes("Alt");
  const needsMeta = parts.includes("Meta");
  return (
    e.code === key &&
    e.ctrlKey === needsCtrl &&
    e.shiftKey === needsShift &&
    e.altKey === needsAlt &&
    e.metaKey === needsMeta
  );
}

export function usePushToTalk(
  microphoneBuffer: MicrophoneBufferType,
  audioContext: AudioContext | undefined
) {
  const { inputMode, pushToTalkKey, isMuted, isServerMuted } = useSettings();
  const effectiveMuted = isMuted || isServerMuted;
  const isPttActiveRef = useRef(false);
  const inElectron = isElectron();

  // Set initial mute state when entering PTT mode
  useEffect(() => {
    if (inputMode !== "push_to_talk" || !microphoneBuffer.muteGain || !audioContext) return;
    if (!effectiveMuted) {
      microphoneBuffer.muteGain.gain.setValueAtTime(0, audioContext.currentTime);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputMode, microphoneBuffer.muteGain, audioContext]);

  // Sync the PTT key binding with the Electron main process
  useEffect(() => {
    if (!inElectron || inputMode !== "push_to_talk") return;
    getElectronAPI()?.setPttKey(pushToTalkKey);
  }, [inElectron, pushToTalkKey, inputMode]);

  // Electron global hotkey listeners (work even when window is unfocused)
  useEffect(() => {
    if (!inElectron) return;
    if (inputMode !== "push_to_talk" || !microphoneBuffer.muteGain || !audioContext) return;

    const api = getElectronAPI();
    if (!api) return;

    const removePttDown = api.onPttDown(() => {
      if (isPttActiveRef.current) return;
      isPttActiveRef.current = true;
      if (!effectiveMuted) {
        microphoneBuffer.muteGain!.gain.setValueAtTime(1, audioContext!.currentTime);
      }
    });

    const removePttUp = api.onPttUp(() => {
      if (!isPttActiveRef.current) return;
      isPttActiveRef.current = false;
      microphoneBuffer.muteGain!.gain.setValueAtTime(0, audioContext!.currentTime);
    });

    return () => {
      removePttDown();
      removePttUp();
    };
  }, [inElectron, inputMode, microphoneBuffer.muteGain, audioContext, effectiveMuted]);

  // Browser keyboard listeners (always active — also works inside Electron
  // when the window IS focused, providing immediate response without IPC lag)
  useEffect(() => {
    if (inputMode !== "push_to_talk" || !microphoneBuffer.muteGain || !audioContext) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isInputFocused()) return;
      if (!matchesPttKey(e, pushToTalkKey)) return;

      isPttActiveRef.current = true;
      if (!effectiveMuted) {
        microphoneBuffer.muteGain!.gain.setValueAtTime(1, audioContext!.currentTime);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isPttActiveRef.current) return;
      const baseKey = pushToTalkKey.split("+").pop() || "";
      if (e.code !== baseKey) return;

      isPttActiveRef.current = false;
      microphoneBuffer.muteGain!.gain.setValueAtTime(0, audioContext!.currentTime);
    };

    // Release PTT on blur only in browser mode — in Electron, the global
    // shortcut continues to work when the window is unfocused
    const handleBlur = () => {
      if (inElectron) return;
      if (isPttActiveRef.current) {
        isPttActiveRef.current = false;
        microphoneBuffer.muteGain!.gain.setValueAtTime(0, audioContext!.currentTime);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [inputMode, pushToTalkKey, microphoneBuffer.muteGain, audioContext, effectiveMuted, inElectron]);

  return { isPttActive: isPttActiveRef };
}
