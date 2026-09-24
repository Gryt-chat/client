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
 * A mention link's label, never its id. An empty label (a stripped nickname)
 * reads as "@someone" rather than nothing.
 */
function mentionToPlainText(_match: string, label: string): string {
  const trimmed = label.trim();
  const name = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return name ? `@${name}` : "@someone";
}

/**
 * The message text a notification or preview can show: mentions resolve to
 * the name in their label, and markdown syntax is gone rather than literal.
 * Custom emoji shortcodes (`:name:`) are already plain text and pass through.
 */
export function toPlainNotificationText(raw: string): string {
  let text = raw;

  // Mentions before generic links: both are `[...](...)`, and a mention must
  // not be read as a link whose "url" happens to be an id.
  text = text.replace(/\[([^\]]*)\]\(mention:[^)]*\)/g, mentionToPlainText);
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => alt.trim());
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, label) => label.trim());

  // Code: keep what is inside, drop the fence or backticks around it.
  text = text.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_m, code) => code.trim());
  text = text.replace(/`([^`]*)`/g, "$1");

  // Emphasis and strikethrough, longest markers first so `**` is not read as two `*`.
  text = text.replace(/(\*\*\*|___)([\s\S]*?)\1/g, "$2");
  text = text.replace(/(\*\*|__)([\s\S]*?)\1/g, "$2");
  text = text.replace(/(\*|_)([\s\S]*?)\1/g, "$2");
  text = text.replace(/~~([\s\S]*?)~~/g, "$1");

  // Line-leading markers: headers, blockquotes, list bullets and ordered items.
  text = text.replace(/^ {0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^ {0,3}>\s?/gm, "");
  text = text.replace(/^ {0,3}([-*+]|\d+[.)])\s+/gm, "");

  return text.trim();
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
  const text = msg.text?.trim() ? toPlainNotificationText(msg.text.trim()) : "";
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
