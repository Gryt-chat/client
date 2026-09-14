/**
 * Whether a macOS audio capture has gone wrong in a way the person sharing should hear about.
 * ScreenCaptureKit hands over buffers even while nothing plays, so no data at all is a fault.
 */

export type CaptureProblem = "permission" | "failed" | "no-audio";

/** How long a macOS capture may run without a single chunk before it counts as broken. */
export const NO_AUDIO_TIMEOUT_MS = 5000;

/** SCStreamError.userDeclined, which the helper prints when Screen Recording is refused. */
const PERMISSION_REFUSED = /SCStreamErrorDomain -3801\]|declined TCC/i;

export interface CaptureExit {
  platform: string;
  code: number | null;
  chunks: number;
  stderr: string;
  /** False when Gryt stopped the capture itself. */
  unexpected: boolean;
}

export function problemFromExit(exit: CaptureExit): CaptureProblem | null {
  if (exit.platform !== "darwin") return null;
  if (!exit.unexpected || exit.chunks > 0) return null;
  if (PERMISSION_REFUSED.test(exit.stderr)) return "permission";
  if (exit.code === 0) return null;
  return "failed";
}

export function problemFromSilence(
  platform: string,
  chunks: number,
  elapsedMs: number,
): CaptureProblem | null {
  if (platform !== "darwin") return null;
  if (chunks > 0 || elapsedMs < NO_AUDIO_TIMEOUT_MS) return null;
  return "no-audio";
}
