import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { getElectronAPI } from "../lib/electron";

/** What the toast is showing about the release it named. */
type Phase = "waiting" | "downloading" | "ready" | "failed";

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
 * Telling somebody a release exists, while they are using the app.
 *
 * Until GRYT-543 nothing did. The update check ran at launch and from the
 * button in Settings, and `aboutSettings.tsx` was the only thing in the whole
 * client subscribed to update status — so a client left open both failed to
 * look and had nowhere to say it if it had.
 *
 * Plain `react-hot-toast`, the one already mounted in `main.tsx`: the container,
 * the surface colour and the border all come from the `toastOptions` there, and
 * dismissing is the library's own `toast.dismiss`. Nothing here is a second
 * toast system.
 *
 * **`announced` raises it; the rest of the statuses move it along.** Only the
 * background check sends `announced`. `available`, `downloading` and
 * `downloaded` also answer a check somebody pressed a button for, and Settings
 * is already showing them that — so those are read only while a toast is
 * already up, and never raise one.
 *
 * **The progress bar is here because the splash is gone.** GRYT-622 deleted the
 * window that used to count a download at you on a black screen, and the
 * download moved behind the app. This is where it surfaces now: the same toast
 * that named the version fills a bar under it and turns into the restart when
 * the bytes are down. Nothing else has to open.
 *
 * **Not `toast.success`.** That puts a green tick on it, and a green tick means
 * the thing you did worked — a file saved, a key copied. Nobody did anything
 * here and nothing succeeded; a release exists. The only colour on this is the
 * accent, carried by the version chip and the bar.
 *
 * **No duration.** It stays until the cross is pressed or the update is taken,
 * rather than sliding past somebody who was reading something else. Dismissing
 * does not bring it back for the same version in this run.
 *
 * **The action is a link, not a filled button.** It restarts Gryt, which drops
 * you out of a call. Bottom-right is the corner people aim at to get rid of
 * things, so the control that sits there is the cross, and the one that
 * restarts is the quiet one.
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
              <Subtitle shown={next} />
            </span>
          </span>
        ),
        { duration: Infinity, id: next.id },
      );
    };

    return api.onUpdateStatus((status) => {
      if (status.status === "announced") {
        if (!status.version) return;

        const id = `update-${status.version}`;

        /* Same release as the toast already up. The one case worth redrawing is
           a download that failed and is being retried by the hourly check —
           otherwise this is the announcement arriving twice. */
        if (shown.current?.id === id) {
          if (shown.current.dismissed) return;
          if (shown.current.phase !== "failed") return;
        } else if (shown.current) {
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

function Subtitle({ shown }: { shown: Shown }) {
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
          <Action onClick={() => getElectronAPI()?.restartForUpdate()}>
            restart and update now
          </Action>
        </>
      );

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
