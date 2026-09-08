import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

/**
 * The warning that a server holds a message key this device did not publish
 * (GRYT-727), and what somebody can do about it.
 *
 * It used to be a bare `toast.error` with `duration: Infinity` and no way out.
 * Two problems, and the second is the one that made it a nuisance:
 *
 *   1. Nothing dismissed it. react-hot-toast puts no control on a default
 *      toast, so the only exit was the condition clearing on its own.
 *   2. Even dismissing it in code did not hold. The warning is re-armed from
 *      every `members:list`, which arrives whenever anybody joins or leaves, so
 *      it came back within seconds.
 *
 * It also told the reader to go and find something in Settings, which is the
 * least useful form of help an app can offer. The two real repairs are here as
 * buttons, and which one shows depends on whether the account already has a
 * sealed copy of the key.
 */

/** What this device can actually do about the mismatch. */
export type DmKeyFix =
  /** The account has a sealed copy; this device can take it. */
  | "unlock"
  /** Signed in with no sealed copy, so there is nothing for a second device
      to take. Setting a message password is what creates one. */
  | "set-up"
  /** A guest, or the account could not be read. Nothing to offer, so the
      warning is only a warning. */
  | "none";

/**
 * Open the person's own settings from outside React.
 *
 * The socket layer is plain modules with no access to the settings hook, and
 * `server_settings_open` next to it already does this for a server's settings.
 */
export function openUserSettings(tab: string): void {
  window.dispatchEvent(new CustomEvent("user_settings_open", { detail: { tab } }));
}

const BODY: Record<DmKeyFix, (server: string) => string> = {
  unlock: (server) =>
    `${server} has a message key this device didn't publish. Your account has a saved copy, ` +
    `so unlock it here and both devices use the same key.`,
  "set-up": (server) =>
    `${server} has a message key this device didn't publish. Each device makes its own key, ` +
    `so signing in somewhere new does this. A message password lets them share one.`,
  none: (server) =>
    `${server} has a message key this device didn't publish. If you haven't signed in on ` +
    `another device, treat direct messages here as readable by the server.`,
};

const ACTION: Record<DmKeyFix, string | null> = {
  unlock: "Unlock it here",
  "set-up": "Set a message password",
  none: null,
};

export function showDmKeyWarning({
  id,
  serverName,
  fix,
  onDismiss,
}: {
  id: string;
  serverName: string;
  fix: DmKeyFix;
  /** Called when Dismiss is pressed, so the warning stays gone. */
  onDismiss: () => void;
}): void {
  const action = ACTION[fix];

  /* `toast.error` for the red mark it draws, same as before. The body is a
     render function so the buttons can sit inside it.

     Stacked rather than in a row: a toast is around 350px wide, and three
     sentences beside two buttons leaves the buttons a few characters each. */
  toast.error(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          {BODY[fix](serverName)}
        </span>

        <div className="flex items-center gap-2" style={{ alignSelf: "flex-end" }}>
          <Button
            tone="neutral"
            size="xsmall"
            onClick={() => {
              toast.dismiss(id);
              onDismiss();
            }}
          >
            Dismiss
          </Button>
          {action && (
            <Button
              size="xsmall"
              onClick={() => {
                toast.dismiss(id);
                openUserSettings("security");
              }}
            >
              {action}
            </Button>
          )}
        </div>
      </div>
    ),
    { id, duration: Infinity },
  );
}
