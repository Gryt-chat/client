import { useEffect, useRef } from "react";

import { useAddons } from "./useAddons";

const ADDON_ATTR = "data-gryt-addon";

function cleanupAddon(addonId: string): void {
  window.dispatchEvent(new CustomEvent(`gryt:addon-cleanup:${addonId}`));
  document
    .querySelectorAll(`[${ADDON_ATTR}="${addonId}"]`)
    .forEach((el) => el.remove());
}

function injectThemeStyles(addonId: string, styles: string[]): void {
  for (const file of styles) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `/addons/${addonId}/${file}`;
    link.setAttribute(ADDON_ATTR, addonId);
    document.head.appendChild(link);
  }
}

function injectPluginScript(addonId: string, main: string): void {
  const script = document.createElement("script");
  script.src = `/addons/${addonId}/${main}`;
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

  useEffect(() => {
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
      if (!addon) continue;

      if (addon.type === "theme" && addon.styles) {
        injectThemeStyles(addon.id, addon.styles);
      }

      if (addon.type === "plugin" && addon.main) {
        injectPluginScript(addon.id, addon.main);
      }
    }

    prevEnabledRef.current = new Set(enabledIds);
  }, [addons, enabledIds]);

  // Re-inject all enabled addons when the addon list changes
  // (e.g. watcher detected file changes -- reload stylesheets)
  const prevAddonsRef = useRef(addons);
  useEffect(() => {
    if (prevAddonsRef.current === addons) return;
    prevAddonsRef.current = addons;

    for (const id of enabledIds) {
      cleanupAddon(id);
      const addon = addons.find((a) => a.id === id);
      if (!addon) continue;

      if (addon.type === "theme" && addon.styles) {
        injectThemeStyles(addon.id, addon.styles);
      }
      if (addon.type === "plugin" && addon.main) {
        injectPluginScript(addon.id, addon.main);
      }
    }
  }, [addons, enabledIds]);
}
