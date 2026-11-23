export const cloudWelcomeKey = (host: string) => `gryt:cloud-welcome:${host}`;
const key = cloudWelcomeKey;

/** Set by the console's Open in Gryt link (welcome=1) and by Add a server when the new Cloud server arrives. */
export function markCloudWelcome(host: string) {
  try {
    localStorage.setItem(key(host), "1");
  } catch {
    /* private mode: no welcome, nothing else lost */
  }
  // The server may be open already: the app joins a new Cloud server before Open in Gryt is pressed.
  window.dispatchEvent(new CustomEvent(WELCOME_EVENT, { detail: host }));
}

export const WELCOME_EVENT = "gryt:cloud-welcome";

export function wantsCloudWelcome(host: string): boolean {
  try {
    return localStorage.getItem(key(host)) === "1";
  } catch {
    return false;
  }
}

