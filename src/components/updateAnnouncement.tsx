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
 * **It does not go away.** Sivert's call: no duration and no dismiss, so the
 * only way to clear it is to take the update. Worth knowing what that costs —
 * the toast sits bottom-right for as long as the app is open, including
 * through a call, and restarting mid-call drops you out of it. The action is
 * therefore labelled with what it actually does rather than "update now".
 *
 * **The action is a link, not a filled button.** Bottom-right is where people
 * click to get rid of things. A filled accent button there is a restart one
 * mis-hit away, and since this one cannot be dismissed the mis-hit is the only
 * click it invites.
 */
export function UpdateAnnouncement() {
  /* The toast id currently on screen. A second, newer release during the same
     run has to replace this one — two permanent toasts would stack and neither
     could be dismissed. */
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

      toast(
        () => (
          <span style={{ display: "block", lineHeight: 1.4, minWidth: 0 }}>
            <span
              style={{
                alignItems: "center",
                display: "flex",
                gap: "0.75rem",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontWeight: 600, letterSpacing: "-0.005em" }}>
                New update available
              </span>
              {/* accent-11 rather than the accent itself: #968ff8 lands around
                  2.8:1 on the light theme's white, which is fine as a fill
                  behind dark text and not fine as text. */}
              <span
                style={{
                  background: "var(--gryt-accent-3)",
                  borderRadius: "var(--gryt-radius-full)",
                  color: "var(--gryt-accent-11)",
                  flex: "none",
                  fontFamily: "var(--code-font-family)",
                  fontSize: "0.72rem",
                  fontWeight: 500,
                  padding: "0.2rem 0.5rem",
                }}
              >
                {status.version}
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
