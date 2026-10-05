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

/** "Gryt Chat has", "Gryt Chat and Home have", "Gryt Chat, Home and 2 more servers have". */
export function serversHave(names: readonly string[]): string {
  if (names.length <= 1) return `${names[0] ?? "This server"} has`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more server${names.length > 3 ? "s" : ""} have`;
}

/* "I don't care", for people whose direct messages don't need to be private from the server.
   Per device, like the key the warning is about; Security settings turns it back on. */
const WARNINGS_OFF_KEY = "gryt_dm_key_warnings_off";

export function dmKeyWarningsOff(): boolean {
  try {
    return localStorage.getItem(WARNINGS_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDmKeyWarningsOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(WARNINGS_OFF_KEY, "1");
    else localStorage.removeItem(WARNINGS_OFF_KEY);
  } catch {
    // No storage: it warns again next launch, the safe direction.
  }
}

const BODY: Record<DmKeyFix, (servers: readonly string[]) => string> = {
  unlock: (servers) =>
    `${serversHave(servers)} a message key this device didn't publish. Your account has a saved copy, ` +
    `so unlock it here and both devices use the same key.`,
  "set-up": (servers) =>
    `${serversHave(servers)} a message key this device didn't publish. Each device makes its own key, ` +
    `so signing in somewhere new does this. A message password lets them share one.`,
  none: (servers) =>
    `${serversHave(servers)} a message key this device didn't publish. If you haven't signed in on ` +
    `another device, treat direct messages there as readable by the server.`,
};

const ACTION: Record<DmKeyFix, string | null> = {
  unlock: "Unlock it here",
  "set-up": "Set a message password",
  none: null,
};

export function showDmKeyWarning({
  id,
  serverNames,
  fix,
  onDismiss,
}: {
  id: string;
  /** Every server with the mismatch, in one toast rather than one each. */
  serverNames: readonly string[];
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
          {BODY[fix](serverNames)}
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
          <Button
            tone="ghost"
            size="xsmall"
            onClick={() => {
              toast.dismiss(id);
              setDmKeyWarningsOff(true);
              onDismiss();
            }}
          >
            Don&rsquo;t warn me again
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
