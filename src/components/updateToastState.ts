import type { UpdateStatus } from "../lib/electron";

/** One id for every release, so a newer one redraws the toast in place rather than stacking a second. */
export const UPDATE_TOAST_ID = "update";

/** What the toast is showing about the release it named. */
export type Phase = "waiting" | "downloading" | "ready" | "installing" | "failed";

export type Shown = {
  version: string;
  phase: Phase;
  percent?: number;
  message?: string;
  /** Install was pressed for an older download, and this newer one installs once it lands. */
  newerAfterPress?: boolean;
  /* The cross was pressed. `toast.dismiss` does not report that back, so without
     a record every later progress event would put the toast up again. */
  dismissed?: boolean;
};

/**
 * The toast after `status`, or null to leave it alone. **`announced` raises it; the
 * rest of the statuses only move it along** (GRYT-543).
 */
export function nextShown(current: Shown | null, status: UpdateStatus): Shown | null {
  if (status.status === "announced") {
    if (!status.version) return null;

    const sameRelease = current?.version === status.version;

    /* Same release as the toast already up. Redrawn for a retry and for
       anything the user asked for; otherwise this is a duplicate. */
    if (sameRelease && !status.reannounce) {
      if (current.dismissed || current.phase !== "failed") return null;
    }

    return {
      version: status.version,
      /* Announced with `autoDownload` means the bytes are already moving —
         the main process says so once electron-updater starts fetching. */
      phase: status.autoDownload ? "downloading" : "waiting",
      /* Only when the release changed: a press during a download installs that same one. */
      newerAfterPress:
        Boolean(status.installWhenReady) &&
        (sameRelease ? Boolean(current.newerAfterPress) : current !== null),
    };
  }

  /* Everything below only edits a toast that is already up. A check run
     from Settings sends the same statuses and must not raise one. */
  if (!current || current.dismissed) return null;

  const version = status.version ?? current.version;

  switch (status.status) {
    case "downloading":
      return { ...current, version, percent: status.percent, phase: "downloading" };

    case "downloaded":
      return { ...current, version, percent: undefined, phase: "ready", newerAfterPress: false };

    case "installing":
      return { ...current, version, percent: undefined, phase: "installing" };

    case "error":
      return { ...current, message: status.message, phase: "failed", newerAfterPress: false };

    default:
      return null;
  }
}
