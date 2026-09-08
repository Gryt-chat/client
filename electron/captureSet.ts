/**
 * Which capture processes to stop and start when the set of applications changes.
 * Keys are the process id: two windows of one application would double its volume.
 */

/** The capture that stands for "everything except Gryt". */
export const SYSTEM_AUDIO_SOURCE_ID = "system";

export interface CapturePlan {
  /** Capture keys to stop. */
  kill: string[];
  /** Capture keys to start. */
  spawn: string[];
  /** Whether the machine-wide capture should be running afterwards. */
  system: boolean;
}

export function planCaptureChange(current: string[], wanted: string[]): CapturePlan {
  // Nothing chosen is not silence: it is the share back on everything except
  // Gryt, which is what it starts as.
  if (wanted.length === 0) {
    return {
      kill: current.filter((id) => id !== SYSTEM_AUDIO_SOURCE_ID),
      spawn: [],
      system: true,
    };
  }

  const unique = [...new Set(wanted)];

  // The machine-wide capture goes when applications are chosen. The chosen
  // ones are already inside it, and running both would send them twice.
  return {
    kill: current.filter((id) => !unique.includes(id)),
    spawn: unique.filter((id) => !current.includes(id)),
    system: false,
  };
}
