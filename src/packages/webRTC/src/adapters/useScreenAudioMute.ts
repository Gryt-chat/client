import { useScreenShare } from "@gryt/voice";
import { useEffect, useState } from "react";

import { singletonHook } from "@/common";

export interface ScreenAudioMute {
  /** True while the audio going out with the screen share is silenced. */
  muted: boolean;
  /** False when there is no shared audio to silence. */
  available: boolean;
  setMuted: (muted: boolean) => void;
}

/**
 * Silences the audio a screen share is sending, without stopping the share.
 * Disabling the track does it, so nothing renegotiates (GRYT-564).
 */
function useScreenAudioMuteHook(): ScreenAudioMute {
  const { screenShareActive, screenAudioStream } = useScreenShare();
  const [muted, setMuted] = useState(false);

  const track = screenAudioStream?.getAudioTracks()[0] ?? null;

  // Each share starts unmuted. Carrying the flag over from the last one would
  // send silence with nothing on screen saying why.
  useEffect(() => {
    if (!screenShareActive) setMuted(false);
  }, [screenShareActive]);

  useEffect(() => {
    if (!track) return;

    track.enabled = !muted;

    // Native capture swaps the track mid-share, and a track that outlives this
    // effect should not stay silenced by a mute the UI has forgotten about.
    return () => {
      track.enabled = true;
    };
  }, [track, muted]);

  return { muted, available: screenShareActive && track !== null, setMuted };
}

export const useScreenAudioMute = singletonHook<ScreenAudioMute>(
  { muted: false, available: false, setMuted: () => {} },
  useScreenAudioMuteHook,
);
