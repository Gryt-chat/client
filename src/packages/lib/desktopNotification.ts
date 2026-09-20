/**
 * OS notifications. Electron's is main-process only, so the app goes through IPC
 * and the browser uses the web API. Both silent: the app plays its own sound.
 */

/** How much of a message goes in the body before it is cut. */
const MAX_BODY = 140;

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export interface NotificationDestination {
  host: string;
  channelId: string;
}

const NOTIFICATION_OPEN_EVENT = "gryt:notification-open";
export const NOTIFICATION_CHANNEL_OPEN_EVENT = "gryt:notification-channel-open";

function dispatchNotificationOpen(destination: NotificationDestination): void {
  window.dispatchEvent(
    new CustomEvent<NotificationDestination>(NOTIFICATION_OPEN_EVENT, {
      detail: destination,
    }),
  );
}

/** Listen for a notification click from Electron or the browser Notification API. */
export function onDesktopNotificationOpen(
  callback: (destination: NotificationDestination) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const bridge = window.electronAPI?.onNotificationClick;
  if (bridge) return bridge(callback);

  const handler = (event: Event) => {
    callback((event as CustomEvent<NotificationDestination>).detail);
  };
  window.addEventListener(NOTIFICATION_OPEN_EVENT, handler);
  return () => window.removeEventListener(NOTIFICATION_OPEN_EVENT, handler);
}

/** Whether this build can raise one at all. */
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
 * Asked from the settings toggle: Chrome and Firefox both refuse a prompt
 * that is not attached to a click.
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
 * An unopened envelope says nothing about itself: the ciphertext is right
 * there in `sealed`.
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

export function showDesktopNotification(
  title: string,
  body: string,
  destination?: NotificationDestination,
): void {
  if (typeof window === "undefined" || !title) return;

  const bridge = window.electronAPI?.showNotification;
  if (bridge) {
    try {
      bridge({ title, body, destination });
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
      if (destination) dispatchNotificationOpen(destination);
      n.close();
    };
  } catch {
    /* Safari throws on the constructor rather than returning null. */
  }
}
