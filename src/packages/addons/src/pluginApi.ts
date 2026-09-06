import {
  type AddonCapability,
  addonMay,
  declaredCapabilities,
} from "./capabilities";
import {
  type PluginMessageHandler,
  requireTopic,
  serversRunning,
  subscribe,
} from "./pluginMessages";

type ThemeInfo = { appearance: "light" | "dark"; accentColor: string };
type ThemeChangeHandler = (theme: ThemeInfo) => void;

/** Set by the app; the API calls it rather than reaching for a socket itself. */
type ActivitySetter = (activity: string) => void;


/** Set by the app. `host` omitted means every server this person is on. */
type PluginMessageSender = (pluginId: string, topic: string, data: unknown, host?: string) => void;

export interface PluginMessaging {
  /**
   * Send to the copy of this plugin running on the server.
   *
   * Goes to every server this person is on unless one is named, the same way a
   * status does — a plugin pair is usually about the person rather than about
   * one room.
   *
   * The server drops it silently if it runs no plugin with this id, which is
   * the ordinary case rather than an error: most servers will not have the
   * other half.
   */
  send(topic: string, data: unknown, host?: string): void;
  /** Hear what the server half sends. Returns a function that stops listening. */
  on(topic: string, handler: PluginMessageHandler): () => void;
  /**
   * The servers running the other half of this plugin, and which version
   * (GRYT-939).
   *
   * Only servers whose copy asked to be visible, so an empty list means "none
   * that said so" rather than "none". Sending anyway is harmless — a server
   * running no half drops it — but a plugin that knows can stop polling, stop
   * drawing an empty panel, and tell somebody why nothing is happening.
   */
  servers(): { host: string; version: string }[];
}

export interface GrytPluginAPI {
  version: string;
  theme: ThemeInfo;
  on(event: "themeChange", handler: ThemeChangeHandler): () => void;
  /**
   * Say what the person running this plugin is doing (GRYT-928, GRYT-929).
   *
   * Needs the `status` capability: declared in the addon's manifest and agreed
   * to by the person, per addon. Without both it throws rather than failing
   * quietly, so a plugin author finds out while writing it.
   *
   * An empty string clears it. The text is capped and cleaned by the server —
   * see `activityText.ts` there — so a long track name is shortened rather
   * than refused.
   *
   * `addonId` is the folder the plugin was loaded from. A plugin does not have
   * to be honest about it, which is the whole reason `capabilities.ts` says
   * this is disclosure rather than a sandbox.
   */
  setActivity(addonId: string, activity: string): void;
  /**
   * The pipe to the copy of this plugin running on a server (GRYT-939).
   *
   * Needs the `messaging` capability. Throws without it, at the call, rather
   * than going quiet — a plugin whose messages vanish is an afternoon somebody
   * does not get back.
   *
   * **What arrives on it was written by whoever runs that server.** Check it.
   */
  messaging(addonId: string): PluginMessaging;
}

declare global {
  interface Window {
    gryt?: GrytPluginAPI;
  }
}

const themeChangeListeners = new Set<ThemeChangeHandler>();

let currentTheme: ThemeInfo = { appearance: "dark", accentColor: "violet" };

/* Set once the app has somewhere to send it. Until then `setActivity` throws
   rather than dropping the call, so a plugin that runs before the app is ready
   is told instead of silently doing nothing. */
let setActivityImpl: ActivitySetter | null = null;

/** What each installed plugin declared, so a grant can be checked against it. */
let declaredByAddon = new Map<string, AddonCapability[]>();

let sendMessageImpl: PluginMessageSender | null = null;

function requireMessaging(addonId: string): void {
  const declared = declaredByAddon.get(addonId) ?? [];
  if (!addonMay(addonId, "messaging", declared)) {
    throw new Error(
      `[gryt] "${addonId}" has no permission to talk to the server. Add ` +
        `"capabilities": ["messaging"] to its manifest, then allow it in ` +
        `Settings, Addons.`,
    );
  }
}

export function initPluginApi(version: string): void {
  const api: GrytPluginAPI = {
    version,
    get theme() {
      return { ...currentTheme };
    },
    on(event, handler) {
      if (event === "themeChange") {
        themeChangeListeners.add(handler);
        return () => themeChangeListeners.delete(handler);
      }
      return () => {};
    },
    setActivity(addonId, activity) {
      const declared = declaredByAddon.get(addonId) ?? [];
      if (!addonMay(addonId, "status", declared)) {
        throw new Error(
          `[gryt] "${addonId}" has no permission to set a status. Add ` +
            `"capabilities": ["status"] to its manifest, then allow it in ` +
            `Settings, Addons.`,
        );
      }
      if (!setActivityImpl) {
        throw new Error("[gryt] Gryt is not ready to set a status yet.");
      }
      setActivityImpl(typeof activity === "string" ? activity : "");
    },
    messaging(addonId) {
      /* Checked when the object is asked for as well as when it is used, so a
         plugin that grabs it at startup finds out then rather than on the first
         thing it tries to say. */
      requireMessaging(addonId);

      return {
        send(topic, data, host) {
          requireMessaging(addonId);
          requireTopic(addonId, topic);
          if (!sendMessageImpl) {
            throw new Error("[gryt] Gryt is not connected to a server yet.");
          }
          sendMessageImpl(addonId, topic, data, host);
        },
        on(topic, handler) {
          requireMessaging(addonId);
          return subscribe(addonId, topic, handler);
        },
        servers() {
          requireMessaging(addonId);
          return serversRunning(addonId);
        },
      };
    },
  };
  window.gryt = api;
}

/** Wire the API to the app's own setter. Called once, from the app. */
export function setPluginApiActivitySetter(setter: ActivitySetter): void {
  setActivityImpl = setter;
}

/** Wire the outbound half. Called from the app, which owns the sockets. */
export function setPluginApiMessageSender(sender: PluginMessageSender | null): void {
  sendMessageImpl = sender;
}


/** Refresh what each addon declared, whenever the installed list changes. */
export function updatePluginApiCapabilities(
  addons: readonly { id: string; capabilities?: string[] }[],
): void {
  declaredByAddon = new Map(
    addons.map((addon) => [addon.id, declaredCapabilities(addon.capabilities)]),
  );
}

export function updatePluginApiTheme(theme: ThemeInfo): void {
  currentTheme = theme;
  for (const handler of themeChangeListeners) {
    try {
      handler({ ...theme });
    } catch (err) {
      console.error("[PluginAPI] themeChange handler threw:", err);
    }
  }
}
