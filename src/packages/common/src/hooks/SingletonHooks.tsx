import { useSyncExternalStore } from "react";

import {
  getRegistrySnapshot,
  registrations,
  subscribeToRegistry
} from "./singletonHook";

/**
 * Runs every singleton hook body. Mount once, above anything that consumes a
 * singleton hook. Rendering it more than once would run every body more than
 * once, which is exactly what these hooks exist to prevent.
 *
 * Separate from singletonHook.ts because react-refresh wants a module to export
 * only components, and the client lints at --max-warnings 0.
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
