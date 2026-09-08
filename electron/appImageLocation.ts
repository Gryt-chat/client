/**
 * Whether the AppImage is still where the `gryt://` handler says it is. Binned,
 * the handler exec's nothing and sign-in never comes back (GRYT-965).
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";

/** Where a recovered AppImage is put. Conventional, and on nobody's PATH by accident. */
export const APPS_DIR = join(homedir(), "Applications");

/**
 * The freedesktop trash. One location, deliberately: a file trashed from another
 * filesystem ends in the same dialog either way.
 */
function trashDir(): string {
  return join(homedir(), ".local", "share", "Trash");
}

export type AppImageState =
  /** Not a Linux AppImage build. Nothing to say. */
  | { kind: "not-applicable" }
  /** Where it says it is. The normal answer. */
  | { kind: "present"; path: string }
  /** Gone from its path, but sitting in the Trash where we can put it back. */
  | { kind: "trashed"; path: string; trashedAt: string; restoreTo: string }
  /** Gone, and not anywhere we know to look. */
  | { kind: "missing"; path: string };

/**
 * Where the running AppImage actually is. `appImagePath` is injected so this can
 * be exercised without one; the caller passes `process.env.APPIMAGE`.
 */
export function appImageState(
  appImagePath: string | undefined,
  platform: string = process.platform,
): AppImageState {
  if (platform !== "linux" || !appImagePath) return { kind: "not-applicable" };
  if (existsSync(appImagePath)) return { kind: "present", path: appImagePath };

  const name = basename(appImagePath);
  const trashedAt = join(trashDir(), "files", name);

  if (existsSync(trashedAt)) {
    return { kind: "trashed", path: appImagePath, trashedAt, restoreTo: join(APPS_DIR, name) };
  }

  return { kind: "missing", path: appImagePath };
}

/**
 * Put a trashed AppImage back, into a directory that is not the Trash. Copy
 * rather than rename: the Trash may be on a different filesystem.
 */
export function restoreFromTrash(state: Extract<AppImageState, { kind: "trashed" }>): string {
  mkdirSync(APPS_DIR, { recursive: true });
  copyFileSync(state.trashedAt, state.restoreTo);

  /* An AppImage that is not executable is a file the desktop entry cannot
     exec, which is the same symptom we are here to fix. */
  chmodSync(state.restoreTo, 0o755);

  try {
    rmSync(state.trashedAt);
    /* The sidecar that makes it show in the Trash UI. Leaving it behind means
       the file manager lists something that is no longer there. */
    rmSync(join(trashDir(), "info", `${basename(state.trashedAt)}.trashinfo`), { force: true });
  } catch {
    /* The copy is what matters. A Trash left slightly untidy is not worth
       failing a recovery over. */
  }

  return state.restoreTo;
}
