import { useEffect, useRef } from "react";

import { getElectronAPI, isElectron } from "../../../lib/electron";
import { useAddons } from "./useAddons";

const ADDON_ATTR = "data-gryt-addon";

function cleanupAddon(addonId: string): void {
  window.dispatchEvent(new CustomEvent(`gryt:addon-cleanup:${addonId}`));
  document
    .querySelectorAll(`[${ADDON_ATTR}="${addonId}"]`)
    .forEach((el) => el.remove());
}

async function resolveAddonUrl(addonId: string, file: string): Promise<string> {
  if (isElectron()) {
    const api = getElectronAPI();
    if (!api) {
      throw new Error("Electron API unavailable");
    }
    return api.resolveAddonAsset(addonId, file);
  }

  return `/addons/${addonId}/${file}`;
}

async function injectThemeStyles(
  addonId: string,
  styles: string[]
): Promise<void> {
  for (const file of styles) {
    const href = await resolveAddonUrl(addonId, file);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(ADDON_ATTR, addonId);
    document.head.appendChild(link);
  }
}

async function injectPluginScript(
  addonId: string,
  main: string
): Promise<void> {
  const src = await resolveAddonUrl(addonId, main);
  const script = document.createElement("script");
  script.src = src;
  script.setAttribute(ADDON_ATTR, addonId);
  document.head.appendChild(script);
}

/**
 * Manages the lifecycle of addon DOM elements (stylesheets and scripts).
 * Renders nothing -- call this once near the app root.
 */
export function useAddonLoader(): void {
  const { addons, enabledIds } = useAddons();
  const prevEnabledRef = useRef<Set<string>>(new Set());
  const prevAddonsRef = useRef(addons);

  useEffect(() => {
    let cancelled = false;

    async function syncAddons(): Promise<void> {
      const prevEnabled = prevEnabledRef.current;

      // Remove addons that were disabled
      for (const id of prevEnabled) {
        if (!enabledIds.has(id)) {
          cleanupAddon(id);
        }
      }

      // Add addons that were newly enabled
      for (const id of enabledIds) {
        if (prevEnabled.has(id)) continue;

        const addon = addons.find((a) => a.id === id);
        if (!addon || cancelled) continue;

        try {
          if (addon.type === "theme" && addon.styles) {
            await injectThemeStyles(addon.id, addon.styles);
          }

          if (addon.type === "plugin" && addon.main) {
            await injectPluginScript(addon.id, addon.main);
          }
        } catch (err) {
          console.error(`[AddonLoader] Failed to load addon "${id}":`, err);
        }
      }

      prevEnabledRef.current = new Set(enabledIds);
    }

    void syncAddons();

    return () => {
      cancelled = true;
    };
  }, [addons, enabledIds]);

  // Re-inject all enabled addons when the addon list changes
  // (e.g. watcher detected file changes -- reload stylesheets)
  useEffect(() => {
    let cancelled = false;

    async function reloadEnabledAddons(): Promise<void> {
      if (prevAddonsRef.current === addons) return;
      prevAddonsRef.current = addons;

      for (const id of enabledIds) {
        cleanupAddon(id);

        const addon = addons.find((a) => a.id === id);
        if (!addon || cancelled) continue;

        try {
          if (addon.type === "theme" && addon.styles) {
            await injectThemeStyles(addon.id, addon.styles);
          }

          if (addon.type === "plugin" && addon.main) {
            await injectPluginScript(addon.id, addon.main);
          }
        } catch (err) {
          console.error(`[AddonLoader] Failed to reload addon "${id}":`, err);
        }
      }
    }

    void reloadEnabledAddons();

    return () => {
      cancelled = true;
    };
  }, [addons, enabledIds]);
}
