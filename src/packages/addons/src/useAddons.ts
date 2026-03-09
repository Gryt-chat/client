import { useCallback, useEffect, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { getElectronAPI } from "../../../lib/electron";

import type { AddonManifest } from "./types";

const ENABLED_PREFIX = "addons.enabled.";

function readEnabledSet(): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(ENABLED_PREFIX)) {
      if (localStorage.getItem(key) === "true") {
        set.add(key.slice(ENABLED_PREFIX.length));
      }
    }
  }
  return set;
}

export interface AddonsState {
  addons: AddonManifest[];
  enabledIds: Set<string>;
  toggleAddon: (id: string) => void;
  openAddonsFolder: () => void;
}

const defaultState: AddonsState = {
  addons: [],
  enabledIds: new Set(),
  toggleAddon: () => {},
  openAddonsFolder: () => {},
};

function useAddonsImpl(): AddonsState {
  const [addons, setAddons] = useState<AddonManifest[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(readEnabledSet);

  useEffect(() => {
    const api = getElectronAPI();
    if (api) {
      api.listAddons().then(setAddons);
      const unsub = api.onAddonsChanged(setAddons);
      return unsub;
    }

    // Web fallback: try fetching addons.json
    fetch("/addons/addons.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AddonManifest[]) => {
        if (Array.isArray(data)) setAddons(data);
      })
      .catch(() => {});
  }, []);

  const toggleAddon = useCallback((id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        localStorage.setItem(ENABLED_PREFIX + id, "false");
      } else {
        next.add(id);
        localStorage.setItem(ENABLED_PREFIX + id, "true");
      }
      return next;
    });
  }, []);

  const openAddonsFolder = useCallback(() => {
    getElectronAPI()?.openAddonsFolder();
  }, []);

  return { addons, enabledIds, toggleAddon, openAddonsFolder };
}

export const useAddons = singletonHook(defaultState, useAddonsImpl);
