import { Button } from "@gryt/ui";
import toast from "react-hot-toast";

/**
 * The warning that a server holds a message key this device did not publish, and
 * what somebody can do about it. Which repair shows depends on the account.
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
 * Open the person's own settings from outside React. The socket layer is plain
 * modules, and `server_settings_open` next to it already does this.
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

  /* `toast.error` for the red mark, with the body as a render function so the
     buttons can sit inside it. Stacked: a toast is around 350px wide. */
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
