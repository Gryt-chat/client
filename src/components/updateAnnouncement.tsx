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
  /* The cross was pressed. `toast.dismiss` does not report that back, and
     without a record of it every later status would put the toast up again —
     a download that keeps going after somebody has said they are not
     interested would reappear on every progress event. */
  dismissed?: boolean;
};

const BAR_HEIGHT = "0.25rem";

/**
 * Telling somebody a release exists while they are using the app (GRYT-543).
 * Plain `react-hot-toast`, the one already in `main.tsx` — nothing here is a
 * second toast system.
 *
 * **`announced` raises it; the rest of the statuses only move it along.** The
 * others also answer a check somebody pressed a button for, and Settings is
 * already showing them that.
 *
 * **Not `toast.success`.** A green tick means the thing you did worked; nobody
 * did anything here.
 *
 * **No duration.** It stays until the cross is pressed or the update is taken.
 * Dismissing does not bring it back for the same version in this run.
 *
 * **The action is a link, not a filled button** — it restarts Gryt, which drops
 * you out of a call, and bottom-right is where people aim to dismiss things.
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
                  /* Redrawn before the handoff, not after: `restartForUpdate`
                     sets the quit flag and hands straight to the installer, so
                     anything queued behind it never paints. */
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

        /* Same release as the toast already up. Redrawn for a retry of a failed
           download, and for anything the user asked for — pressing Check for
           Updates or reloading the window. Otherwise this is the announcement
           arriving twice. */
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
             the main process only says so once electron-updater has accepted
             the release and started fetching. */
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

    /* The toast is state in this component, and the announcement was a message
       sent once. A reload therefore lost it for good: the main process had
       already recorded the version as announced, so nothing would send it again
       until the app restarted (GRYT-633). Asking on mount covers the reload and
       costs one message on a normal start, where there is nothing to replay. */
    api.replayUpdateStatus();

    return unsubscribe;
  }, []);

  return null;
}

/**
 * How far the download has got.
 *
 * Indeterminate until the first `download-progress` event, which is a second or
 * two after the announcement on a fast line and much longer on a slow one. A
 * bar sitting at zero reads as stuck, so there is no bar until there is a
 * number — the text carries it in the meantime.
 */
function ProgressBar({ percent }: { percent?: number }) {
  if (percent == null) return null;

  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{
        background: "var(--gryt-accent-3)",
        borderRadius: "var(--gryt-radius-full)",
        display: "block",
        height: BAR_HEIGHT,
        marginTop: "0.5rem",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <span
        style={{
          background: "var(--gryt-accent-9)",
          borderRadius: "var(--gryt-radius-full)",
          display: "block",
          height: BAR_HEIGHT,
          transition: "width 200ms linear",
          width: `${Math.min(100, Math.max(0, percent))}%`,
        }}
      />
    </span>
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

    /* The window is about to go, and on the way back the installer runs before
       anything is drawn. That gap reads as Gryt having closed and failed to
       reopen, and somebody who reads it that way opens it again, which is the
       one thing that makes it worse (GRYT-646).
     *
     * Nothing can be shown during the gap, because nothing is running. This is
       the moment before it: the press gets an answer, and the window closing
       becomes the expected next thing. */
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
