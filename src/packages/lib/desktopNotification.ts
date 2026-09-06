/**
 * OS notifications, for a message that arrives while somebody is elsewhere.
 *
 * Two ways of doing the same thing. In the desktop app it goes through the
 * main process, because Electron's Notification is a main-process API and the
 * renderer cannot reach it. In a browser at gryt.chat it is the web
 * Notification API, which needs permission first.
 *
 * Both are silent. The app plays its own message sound from the same event,
 * and a second one from the OS is two noises for one message.
 */

/** How much of a message goes in the body before it is cut. */
const MAX_BODY = 140;

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

/**
 * Whether this build can raise one at all.
 *
 * The desktop app answers yes as long as it is new enough to have the bridge;
 * an older build simply does not have `showNotification` on the API object,
 * which is the same check the rest of `electronAPI` uses for added methods.
 */
export function canNotify(): boolean {
  if (typeof window === "undefined") return false;
  if (window.electronAPI?.showNotification) return true;
  return typeof Notification !== "undefined";
}

export function notificationPermission(): NotificationPermissionState {
  if (typeof window === "undefined") return "unsupported";
  // The app never asks. The OS decides whether to show it, and there is no
  // in-app prompt to answer.
  if (window.electronAPI?.showNotification) return "granted";
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * Ask the browser, if it has not been asked.
 *
 * Called from the settings toggle rather than on startup, because Chrome and
 * Firefox both refuse a permission prompt that is not attached to something
 * the person just clicked.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === "undefined") return "unsupported";
  if (window.electronAPI?.showNotification) return "granted";
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

/**
 * What to put under the title.
 *
 * An encrypted message that has not been opened yet says nothing about itself,
 * on purpose: the ciphertext is right there in `sealed` and putting anything
 * derived from it on the lock screen would be worse than saying little. A
 * message with only files on it says so rather than arriving blank.
 */
export function notificationBody(msg: {
  text?: string | null;
  sealed?: string | null;
  attachments?: string[] | null;
}): string {
  const text = msg.text?.trim();
  if (text) return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text;
  if (msg.sealed) return "Sent an encrypted message";
  if (msg.attachments && msg.attachments.length > 0) {
    return msg.attachments.length === 1 ? "Sent an attachment" : `Sent ${msg.attachments.length} attachments`;
  }
  return "Sent a message";
}

export function showDesktopNotification(title: string, body: string): void {
  if (typeof window === "undefined" || !title) return;

  const bridge = window.electronAPI?.showNotification;
  if (bridge) {
    try {
      bridge({ title, body });
    } catch {
      /* The main process is the only thing that can fail here, and a missed
         notification is not worth an error to the person reading it. */
    }
    return;
  }

  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, silent: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* Safari throws on the constructor rather than returning null. */
  }
}
