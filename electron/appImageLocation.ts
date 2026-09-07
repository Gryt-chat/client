/**
 * Whether the AppImage is still where the `gryt://` handler says it is
 * (GRYT-965).
 *
 * ## The failure
 *
 * An AppImage is the app, not an installer, so people run it and then bin the
 * "installer". Linux keeps the running process alive off the deleted inode, so
 * nothing looks wrong — but `ensureLinuxAppImageProtocolHandler` wrote a
 * `.desktop` entry pointing at where the file used to be, and the browser now
 * resolves `gryt://` to a launcher that exec's nothing. Sign-in goes out and
 * never comes back, with no error at any layer.
 *
 * ## Why the check is here and not at startup
 *
 * The handler is rewritten from `process.env.APPIMAGE` on every launch, so at
 * startup it has *just* been made correct and a check there could never fire.
 * The entry only goes stale while the app keeps running and the file moves out
 * from under it. So this is asked at the moment it matters — right before
 * handing sign-in to the browser, which is the thing that needs the handler.
 *
 * ## What can and cannot be recovered
 *
 * Measured on a real box: every Gryt process resolves `/proc/<pid>/exe` to the
 * mounted squashfs at `/tmp/.mount_…`, and the AppImage launcher has already
 * exited. Nothing holds the `.AppImage` open, so its bytes cannot be recovered
 * from the running process — a "put it back for you" button is not possible in
 * general.
 *
 * What is possible is the case that actually happens: the file went to Trash,
 * which is a known path. So this looks there, and offers a real one-click fix
 * when it finds it. When it does not, it says so rather than pretending.
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";

/** Where a recovered AppImage is put. Conventional, and on nobody's PATH by accident. */
export const APPS_DIR = join(homedir(), "Applications");

/**
 * The freedesktop trash. One location, deliberately.
 *
 * A file trashed from another filesystem lands in `.Trash-1000` at that
 * filesystem's root instead, and chasing every mount to find it would be a lot
 * of work for a case that ends in the same dialog either way — the fallback
 * already handles "cannot find it".
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
 * Where the running AppImage actually is.
 *
 * `appImagePath` is injected rather than read here so this can be exercised
 * without an AppImage; the caller passes `process.env.APPIMAGE`.
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
 * Put a trashed AppImage back, into a directory that is not the Trash.
 *
 * Copy rather than rename: the Trash may be on a different filesystem, where a
 * rename fails outright. The original is removed afterwards, so this is a move
 * when it can be and a copy-then-delete when it cannot.
 *
 * `~/Applications` is created if it is not there — it does not exist by default
 * on a fresh Arch install, which is where this was found.
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
