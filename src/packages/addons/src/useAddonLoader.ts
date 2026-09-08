import { useEffect, useRef } from "react";

import { getElectronAPI, isElectron } from "../../../lib/electron";
import { startPlugin, stopPlugin } from "./pluginHost";
import { useAddons } from "./useAddons";

const ADDON_ATTR = "data-gryt-addon";
const CLEANUP_WAIT_MS = 150;

/**
 * Take an addon back off, whichever kind it is. A theme is elements in the head;
 * a plugin is a worker, and `stopPlugin` terminates it either way (GRYT-930).
 */
function cleanupAddon(addonId: string): void {
  stopPlugin(addonId);
  document
    .querySelectorAll(`[${ADDON_ATTR}="${addonId}"]`)
    .forEach((el) => el.remove());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Start a plugin in a worker of its own. It used to be a `<script type="module">`
 * on the app's own page, which made the capabilities intent rather than a bound.
 */
async function startPluginWorker(
  addonId: string,
  main: string,
  capabilities: string[] | undefined,
  /* The manifest's `name`, carried through so a panel can be drawn with it. The
     host falls back to the id, which is a folder name (GRYT-951). */
  addonName: string
): Promise<void> {
  const src = await resolveAddonUrl(addonId, main);
  startPlugin(addonId, src, capabilities, addonName);
}

function requestReload(): void {
  window.location.reload();
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
          const addon =
            addons.find((a) => a.id === id) ??
            prevAddonsRef.current.find((a) => a.id === id);

          cleanupAddon(id);

          if (
            addon?.type === "plugin" &&
            addon.requiresReloadOnDisable === true
          ) {
            await delay(CLEANUP_WAIT_MS);
            if (!cancelled) {
              requestReload();
              return;
            }
          }
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
            await startPluginWorker(addon.id, addon.main, addon.capabilities, addon.name);
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
            await startPluginWorker(addon.id, addon.main, addon.capabilities, addon.name);
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
