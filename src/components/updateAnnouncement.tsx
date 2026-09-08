import { Progress } from "@gryt/ui";
import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { getElectronAPI } from "../lib/electron";

/** What the toast is showing about the release it named. */
type Phase = "waiting" | "downloading" | "ready" | "installing" | "failed";

type Shown = {
  id: string;
  version: string;
  phase: Phase;
  percent?: number;
  message?: string;
  /* The cross was pressed. `toast.dismiss` does not report that back, so without
     a record every later progress event would put the toast up again. */
  dismissed?: boolean;
};


/**
 * Telling somebody a release exists while they are using the app. **`announced`
 * raises it; the rest of the statuses only move it along** (GRYT-543).
 */
export function UpdateAnnouncement() {
  /* The toast currently on screen. A newer release during the same run has to
     replace it — with no duration, two would stack and sit there. */
  const shown = useRef<Shown | null>(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    const render = (next: Shown) => {
      shown.current = next;

      toast(
        (t) => (
          <span style={{ display: "block", lineHeight: 1.4, minWidth: 0 }}>
            <span
              style={{
                alignItems: "center",
                display: "flex",
                gap: "0.5rem",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600, letterSpacing: "-0.005em", minWidth: 0 }}>
                New update available
              </span>

              <span
                style={{ alignItems: "center", display: "flex", flex: "none", gap: "0.5rem" }}
              >
                {/* accent-11 rather than the accent itself: #968ff8 lands around
                    2.8:1 on the light theme's white, which is fine as a fill
                    behind dark text and not fine as text. */}
                <span
                  style={{
                    background: "var(--gryt-accent-3)",
                    borderRadius: "var(--gryt-radius-full)",
                    color: "var(--gryt-accent-11)",
                    fontFamily: "var(--code-font-family)",
                    fontSize: "0.72rem",
                    fontWeight: 500,
                    padding: "0.2rem 0.5rem",
                  }}
                >
                  {next.version}
                </span>

                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => {
                    if (shown.current) shown.current.dismissed = true;
                    toast.dismiss(t.id);
                  }}
                  style={{
                    alignItems: "center",
                    background: "none",
                    border: 0,
                    borderRadius: "var(--gryt-radius-full)",
                    color: "var(--gryt-muted)",
                    cursor: "pointer",
                    display: "flex",
                    height: "1.25rem",
                    justifyContent: "center",
                    padding: 0,
                    width: "1.25rem",
                  }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </span>
            </span>

            {next.phase === "downloading" && <ProgressBar percent={next.percent} />}

            <span
              style={{
                color: "var(--gryt-muted)",
                display: "block",
                fontSize: "0.78rem",
                marginTop: "0.3rem",
              }}
            >
              <Subtitle
                shown={next}
                onInstall={() => {
                  /* Redrawn before the handoff: `restartForUpdate` hands straight
                     to the installer, so anything queued behind it never paints. */
                  render({ ...next, phase: "installing" });
                  getElectronAPI()?.restartForUpdate();
                }}
              />
            </span>
          </span>
        ),
        { duration: Infinity, id: next.id },
      );
    };

    const unsubscribe = api.onUpdateStatus((status) => {
      if (status.status === "up-to-date") {
        /* Only ever arrives for a check somebody pressed. Short, because it is
           an answer rather than news, and there is nothing to act on. */
        toast("Gryt is up to date", { duration: 4000, id: "update-none" });
        return;
      }

      if (status.status === "announced") {
        if (!status.version) return;

        const id = `update-${status.version}`;

        /* Same release as the toast already up. Redrawn for a retry and for
           anything the user asked for; otherwise this is a duplicate. */
        if (shown.current?.id === id && !status.reannounce) {
          if (shown.current.dismissed) return;
          if (shown.current.phase !== "failed") return;
        } else if (shown.current && shown.current.id !== id) {
          toast.dismiss(shown.current.id);
        }

        render({
          id,
          version: status.version,
          /* Announced with `autoDownload` means the bytes are already moving —
             the main process says so once electron-updater starts fetching. */
          phase: status.autoDownload ? "downloading" : "waiting",
        });

        return;
      }

      /* Everything below only edits a toast that is already up. A check run
         from Settings sends the same statuses and must not raise one. */
      const current = shown.current;
      if (!current || current.dismissed) return;

      switch (status.status) {
        case "downloading":
          render({ ...current, percent: status.percent, phase: "downloading" });
          break;

        case "downloaded":
          render({ ...current, percent: undefined, phase: "ready" });
          break;

        case "error":
          render({ ...current, message: status.message, phase: "failed" });
          break;

        default:
          break;
      }
    });

    /* The toast is state here and the announcement was sent once, so a reload
       lost it for good. Asking on mount covers that (GRYT-633). */
    api.replayUpdateStatus();

    return unsubscribe;
  }, []);

  return null;
}

/**
 * How far the download has got. No bar until there is a number — a bar sitting at
 * zero reads as stuck, and `value={null}` is a different thing from no bar.
 */
function ProgressBar({ percent }: { percent?: number }) {
  if (percent == null) return null;

  return (
    <Progress
      className="mt-2"
      value={Math.min(100, Math.max(0, percent))}
    />
  );
}

function Subtitle({
  shown,
  onInstall,
}: {
  shown: Shown;
  onInstall: () => void;
}) {
  switch (shown.phase) {
    case "waiting":
      return (
        <>
          {"Automatic updates are off · "}
          <Action onClick={() => getElectronAPI()?.downloadUpdate()}>
            download now
          </Action>
        </>
      );

    case "downloading":
      return shown.percent == null
        ? <>Downloading…</>
        : <>{`Downloading… ${shown.percent}%`}</>;

    case "ready":
      return (
        <>
          {"Installs when you quit · "}
          <Action onClick={onInstall}>
            restart and update now
          </Action>
        </>
      );

    /* The window is about to go, and the installer runs before anything is drawn
       on the way back. Nothing can be shown in that gap (GRYT-646). */
    case "installing":
      return <>Installing… Gryt will restart on its own.</>;

    case "failed":
      return (
        <>
          {"Download failed · "}
          <Action onClick={() => getElectronAPI()?.downloadUpdate()}>
            try again
          </Action>
        </>
      );
  }
}

function Action({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: 0,
        color: "var(--gryt-accent-11)",
        cursor: "pointer",
        font: "inherit",
        fontWeight: 500,
        padding: 0,
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      }}
    >
      {children}
    </button>
  );
}
