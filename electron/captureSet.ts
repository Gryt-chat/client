/**
 * Working out which capture processes to stop and start when the set of
 * applications a share sends audio from changes.
 *
 * Kept apart from the process handling so it can be checked without Windows
 * (scripts/check-capture-set.mjs). Getting it wrong is not subtle: stop one
 * too many and the share goes silent, keep one too many and an application
 * somebody deselected is still going out.
 *
 * Keys are whatever the caller captures by, which for applications is the
 * process id: two windows of the same application share one, and capturing it
 * twice would send that application at double volume.
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
