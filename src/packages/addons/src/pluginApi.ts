type ThemeInfo = { appearance: "light" | "dark"; accentColor: string };
type ThemeChangeHandler = (theme: ThemeInfo) => void;

export interface GrytPluginAPI {
  version: string;
  theme: ThemeInfo;
  on(event: "themeChange", handler: ThemeChangeHandler): () => void;
}

declare global {
  interface Window {
    gryt?: GrytPluginAPI;
  }
}

const themeChangeListeners = new Set<ThemeChangeHandler>();

let currentTheme: ThemeInfo = { appearance: "dark", accentColor: "violet" };

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
  };
  window.gryt = api;
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
