import type { RichPresenceSocketStatus } from "../../../../lib/electron";

/** What settings says about the game connection. Kept apart so a test can read every case. */
export function socketLine({ state, holder, helper }: RichPresenceSocketStatus): { text: string; warn: boolean; fix?: string } {
  if (state === "holding" && helper) {
    return { text: "The Gryt helper has the game connection. Games you start now report to Gryt instead of Discord.", warn: false };
  }
  if (state === "holding") {
    return { text: "Gryt has the game connection. Games you start now report to Gryt instead of Discord.", warn: false };
  }
  if (state === "off") return { text: "", warn: false };
  if (holder?.isDiscord) {
    return {
      text: `${holder.name} is holding the game connection, so games report to ${holder.name} instead of Gryt.`,
      warn: true,
      fix: `Quit ${holder.name} and Gryt takes the connection over a few seconds later. No restart needed.`,
    };
  }
  if (holder) {
    return {
      text: `${holder.name} is holding the game connection, so games can't reach Gryt.`,
      warn: true,
      fix: `Quit ${holder.name} and Gryt takes the connection over a few seconds later.`,
    };
  }
  return {
    text: "Another program is holding the game connection, so games can't reach Gryt.",
    warn: true,
    fix: "Gryt keeps checking, and takes the connection as soon as it's free.",
  };
}

/** The one-time notice, for the first time Discord is found holding it after turning this on. */
export function heldNotice(name: string): string {
  return `${name} got to the game connection first, so games report to ${name} instead of Gryt. Settings, under Profile, says how to fix it.`;
}
