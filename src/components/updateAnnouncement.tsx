import { useEffect, useRef } from "react";
import toast from "react-hot-toast";

import { getElectronAPI } from "../lib/electron";

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
 * **Only `announced` raises this.** That status comes from the background
 * check alone. `available` answers a check somebody pressed a button for, and
 * Settings is already showing them the answer; toasting that would be telling
 * somebody what they are looking at.
 *
 * **Not `toast.success`.** That puts a green tick on it, and a green tick means
 * the thing you did worked — a file saved, a key copied. Nobody did anything
 * here and nothing succeeded; a release exists. The only colour on this is the
 * accent, carried by the version chip and nothing else.
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
  const shown = useRef<string | null>(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    return api.onUpdateStatus((status) => {
      if (status.status !== "announced" || !status.version) return;

      const id = `update-${status.version}`;
      if (shown.current === id) return;
      if (shown.current) toast.dismiss(shown.current);
      shown.current = id;

      const version = status.version;

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
                  {version}
                </span>

                <button
                  type="button"
                  aria-label="Dismiss"
                  onClick={() => toast.dismiss(t.id)}
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

            <span
              style={{
                color: "var(--gryt-muted)",
                display: "block",
                fontSize: "0.78rem",
                marginTop: "0.3rem",
              }}
            >
              {"Installs next launch · "}
              <button
                type="button"
                onClick={() => getElectronAPI()?.restartForUpdate()}
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
                restart and update now
              </button>
            </span>
          </span>
        ),
        { duration: Infinity, id },
      );
    });
  }, []);

  return null;
}
