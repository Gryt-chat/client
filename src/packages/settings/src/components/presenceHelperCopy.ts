import type { PresenceHelperStatus } from "../../../../lib/electron";

/** What settings says about gryt-helper. Kept apart so a test can read every case. */
export const helperCopy = {
  title: "Gryt helper",
  about:
    "Games only talk to whoever opens the connection first. The Gryt helper is a small program that starts when you log in, so it usually gets there before Discord does. It holds on to what games say until you open Gryt.",
  cost: "While it has the connection, games report to Gryt instead of Discord, even when Gryt is closed.",
  turnOn: "Turn on the Gryt helper",
  warningHint: "It starts when you log in, so it can get there before Discord.",
  turnOff: "Turn off the Gryt helper",
  offNote: "Turning it off stops it now and takes it out of your startup programs.",
};

export function helperStateLine(status: Pick<PresenceHelperStatus, "enabledAt" | "needsApproval" | "error">): {
  text: string;
  warn: boolean;
} | null {
  if (status.error) return { text: `The helper couldn't be set up: ${status.error}`, warn: true };
  if (!status.enabledAt) return null;
  if (status.needsApproval) {
    return {
      text: "macOS needs you to allow it first. Open System Settings, then General, then Login Items, and turn on Gryt Chat.",
      warn: true,
    };
  }
  return { text: "The Gryt helper is on. It starts when you log in.", warn: false };
}
