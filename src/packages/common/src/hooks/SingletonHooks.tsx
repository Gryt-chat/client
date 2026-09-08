import { useSyncExternalStore } from "react";

import {
  getRegistrySnapshot,
  registrations,
  subscribeToRegistry
} from "./singletonHook";

/**
 * Runs every singleton hook body. Mount once, above anything that consumes one.
 * Separate from singletonHook.ts because react-refresh wants only components.
 */
export function SingletonHooks() {
  // Hook modules register on import. If one is imported lazily, after this has
  // already mounted, the count changes and this re-renders to pick it up.
  useSyncExternalStore(
    subscribeToRegistry,
    getRegistrySnapshot,
    getRegistrySnapshot
  );

  return <>{registrations.map((registration) => registration.render())}</>;
}
