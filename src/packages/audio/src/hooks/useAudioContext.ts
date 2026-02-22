import { useEffect, useState } from "react";
import { singletonHook } from "react-singleton-hook";

/**
 * Shared AudioContext singleton. Created lazily on first access,
 * shared between useMicrophone and useSpeakers so both hooks
 * process audio through the same context (avoiding extra threads
 * and resamplers).
 *
 * Browsers require a user gesture before the AudioContext can leave
 * the "suspended" state (autoplay policy). We attach a one-shot
 * interaction listener that resumes it on the first click/keydown.
 */
function useAudioContextHook(): AudioContext | undefined {
  const [ctx, setCtx] = useState<AudioContext | undefined>(undefined);

  useEffect(() => {
    const ac = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    setCtx(ac);

    const resume = () => {
      if (ac.state === "suspended") {
        ac.resume().catch(() => {});
      }
    };

    resume();

    document.addEventListener("click", resume, { once: true });
    document.addEventListener("keydown", resume, { once: true });

    return () => {
      document.removeEventListener("click", resume);
      document.removeEventListener("keydown", resume);
      ac.close().catch(() => {});
    };
  }, []);

  return ctx;
}

export const useSharedAudioContext = singletonHook<AudioContext | undefined>(
  undefined,
  useAudioContextHook,
);
