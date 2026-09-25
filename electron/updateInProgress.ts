/**
 * A Windows update in flight. The installer takes ten seconds or more, and a launch in that
 * time used to start a second Gryt from the files being replaced (GRYT-1496).
 */

import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** installer.nsh reads both names from the same folder, so they can't change on one side. */
export const INSTALL_MARKER = "update-installing.json";
export const REOPEN_REQUEST = "update-reopen";

/** What the installer passes to the Gryt it starts, and nothing else does. */
export const UPDATED_ARG = "--updated";

/** Past this a marker is left over from an install that died, not one still running. */
export const MARKER_MAX_AGE_MS = 5 * 60 * 1000;

export type InstallMarker = {
  version: string;
  installer: string;
  /** The installer starts Gryt afterwards: a restart, not an install on quit. */
  reopens: boolean;
  at: number;
};

export type LaunchVerdict =
  /** Nothing is installing, or this is the Gryt the installer started. */
  | "carry-on"
  /** The marker is stale: clear it and start normally. */
  | "clear"
  /** An installer is running: say so and exit without touching its files. */
  | "wait";

export function launchVerdict({
  marker,
  argv,
  now,
  installerRunning,
}: {
  marker: InstallMarker | null;
  argv: readonly string[];
  now: number;
  installerRunning: (installer: string) => boolean;
}): LaunchVerdict {
  if (!marker) return "carry-on";
  // Kept until its window is up, since the installer waits on the file to know that.
  if (argv.includes(UPDATED_ARG)) return "carry-on";
  if (now - marker.at > MARKER_MAX_AGE_MS || marker.at - now > MARKER_MAX_AGE_MS) return "clear";
  return installerRunning(marker.installer) ? "wait" : "clear";
}

export function readInstallMarker(dir: string): InstallMarker | null {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, INSTALL_MARKER), "utf8")) as Partial<InstallMarker>;
    if (typeof parsed.installer !== "string" || typeof parsed.at !== "number") return null;
    return {
      version: typeof parsed.version === "string" ? parsed.version : "",
      installer: parsed.installer,
      reopens: parsed.reopens === true,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

export function writeInstallMarker(dir: string, marker: InstallMarker): void {
  writeFileSync(join(dir, INSTALL_MARKER), JSON.stringify(marker), "utf8");
}

export function clearInstallMarker(dir: string): void {
  rmSync(join(dir, INSTALL_MARKER), { force: true });
}

/** Asks an install on quit to start Gryt when it finishes. A restart starts it anyway. */
export function requestReopen(dir: string): void {
  writeFileSync(join(dir, REOPEN_REQUEST), "", "utf8");
}

/** Windows refuses to open a running executable for writing, which is all this asks. */
export function installerRunning(installer: string): boolean {
  if (!existsSync(installer)) return false;
  try {
    closeSync(openSync(installer, "r+"));
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EBUSY" || code === "EPERM" || code === "EACCES";
  }
}
