import { useCallback, useEffect, useState } from "react";

import { singletonHook } from "@/common";

export interface SharedAudioContextValue {
  audioContext: AudioContext | undefined;
  activate: () => void;
}

/**
 * Shared AudioContext singleton, shared between useMicrophone and
 * useSpeakers so both hooks process audio through the same context
 * without extra threads/resamplers.
 *
 * Important: this must not intentionally suspend just because the
 * document/window is hidden. Voice capture must continue while the user
 * alt-tabs away from Gryt.
 */
function useAudioContextHook(): SharedAudioContextValue {
  const [ctx, setCtx] = useState<AudioContext | undefined>(undefined);
  const [activated, setActivated] = useState(false);

  const activate = useCallback(() => {
    setActivated(true);
  }, []);

  useEffect(() => {
    if (!activated) return;

    const ac = new AudioContext({
      latencyHint: "interactive",
      sampleRate: 48000,
    });

    setCtx(ac);

    const resume = () => {
      if (ac.state === "suspended") {
        ac.resume().catch(() => {});
      }
    };

    resume();

    // Keep trying to resume when the OS/browser returns focus to the app.
    // Do not use { once: true } here; the context may be suspended again
    // after focus/visibility changes.
    document.addEventListener("click", resume);
    document.addEventListener("keydown", resume);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);

    return () => {
      document.removeEventListener("click", resume);
      document.removeEventListener("keydown", resume);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);

      ac.close().catch(() => {});
    };
  }, [activated]);

  return { audioContext: ctx, activate };
}

const initValue: SharedAudioContextValue = {
  audioContext: undefined,
  activate: () => {},
};

export const useSharedAudioContext = singletonHook<SharedAudioContextValue>(
  initValue,
  useAudioContextHook,
);
