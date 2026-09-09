/* A handle for driving the client from a debugger, or from an agent over CDP.
   Dev builds only: `import.meta.env.DEV` folds this whole file away (GRYT-1115). */

import { getIdentityWords, restoreIdentityFromWords } from "@/common";
import { generateSeed, seedToWords } from "@/common/src/auth/identity-seed";
import { getUserValue, loadedUserId } from "@/settings";

/** Named identities, per browser profile and per origin, like everything else here. */
const SAVED_KEY = "gryt.dev.identities";

type Saved = Record<string, string>;

function saved(): Saved {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as Saved;
  } catch {
    return {};
  }
}

function writeSaved(next: Saved): void {
  localStorage.setItem(SAVED_KEY, JSON.stringify(next));
}

/** Becoming somebody else drops every key and token, so the page has to start over. */
async function becomeWords(words: string): Promise<void> {
  await restoreIdentityFromWords(words.trim());
  location.reload();
}

const toolkit = {
  /** Who this profile currently is, and what it can reach. */
  async whoami() {
    return {
      userId: loadedUserId(),
      nickname: getUserValue<string | null>("nickname", null),
      servers: Object.keys(getUserValue<Record<string, unknown>>("servers", {})),
      words: await getIdentityWords(),
      saved: Object.keys(saved()),
    };
  },

  /** Keep the current identity under a name so you can come back to it. */
  async save(name: string) {
    if (!name) throw new Error("save(name) needs a name");
    writeSaved({ ...saved(), [name]: await getIdentityWords() });
    return Object.keys(saved());
  },

  /** The names this profile has stored. */
  identities() {
    return Object.keys(saved());
  },

  /** Become a saved identity. Reloads. */
  async become(name: string) {
    const words = saved()[name];
    if (!words) throw new Error(`no saved identity called ${name}. Have: ${this.identities().join(", ") || "none"}`);
    await becomeWords(words);
  },

  /** Become an identity from its 24 words. Reloads. */
  async becomeWords(words: string) {
    await becomeWords(words);
  },

  /* A brand new person, saved under `name` before the reload takes the page
     away. Join a server as them and you are a second member of it. */
  async fresh(name: string) {
    if (!name) throw new Error("fresh(name) needs a name");
    const words = seedToWords(generateSeed());
    writeSaved({ ...saved(), [name]: words });
    await becomeWords(words);
  },

  /** Forget a saved identity. The identity itself is unaffected. */
  forget(name: string) {
    const next = saved();
    delete next[name];
    writeSaved(next);
    return Object.keys(next);
  },

  /** Open the user settings, on a named tab. */
  settings(tab = "appearance") {
    window.dispatchEvent(new CustomEvent("user_settings_open", { detail: { tab } }));
  },

  /** Open the server settings, on a named tab, for a host or the first one joined. */
  serverSettings(tab = "overview", host?: string) {
    const target = host ?? Object.keys(getUserValue<Record<string, unknown>>("servers", {}))[0];
    if (!target) throw new Error("no server joined, so there are no server settings to open");
    window.dispatchEvent(
      new CustomEvent("server_settings_open", { detail: { host: target, tab } }),
    );
  },

  /* Open a direct conversation with somebody by nickname. There is no other way
     in: the member card it normally starts from ignores a synthetic click. */
  dm(nickname: string) {
    window.dispatchEvent(new CustomEvent("dev_open_dm", { detail: { nickname } }));
  },

  /** Close whatever is open, the way Escape does. */
  close() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  },

  help() {
    return [
      "gryt.whoami()                  who this profile is, and its saved names",
      "gryt.save(name)                keep the current identity under a name",
      "gryt.identities()              the names this profile has stored",
      "gryt.become(name)              become a saved identity, then reload",
      "gryt.becomeWords(words)        become an identity from its 24 words",
      "gryt.fresh(name)               a brand new person, saved and become",
      "gryt.forget(name)              drop a saved name",
      "gryt.settings(tab)             open user settings on a tab",
      "gryt.serverSettings(tab, host) open server settings on a tab",
      "gryt.dm(nickname)              open a direct conversation",
      "gryt.close()                   close what is open",
    ].join("\n");
  },
};

export type AiToolkit = typeof toolkit;

/** Called from main.tsx, already behind `import.meta.env.DEV`. */
export function installAiToolkit(): void {
  (window as unknown as { gryt: AiToolkit }).gryt = toolkit;
  console.info("[dev] window.gryt is here. gryt.help() lists what it does.");
}
