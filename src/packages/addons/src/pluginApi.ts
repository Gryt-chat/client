import {
  type AddonCapability,
  addonMay,
  declaredCapabilities,
} from "./capabilities";

type ThemeInfo = { appearance: "light" | "dark"; accentColor: string };
type ThemeChangeHandler = (theme: ThemeInfo) => void;

/** Set by the app; the API calls it rather than reaching for a socket itself. */
type ActivitySetter = (activity: string) => void;

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
  };
  window.gryt = api;
}

/** Wire the API to the app's own setter. Called once, from the app. */
export function setPluginApiActivitySetter(setter: ActivitySetter): void {
  setActivityImpl = setter;
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
