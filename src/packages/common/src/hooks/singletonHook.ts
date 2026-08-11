import type { ReactElement } from "react";
import { createElement, useLayoutEffect, useSyncExternalStore } from "react";

/**
 * A drop-in replacement for react-singleton-hook.
 *
 * The package it replaces was last published in November 2022 and reads
 * ReactDOM.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED, which React 19
 * removed — so it does not merely warn on install, it breaks at runtime. It
 * also mounted a second React root on a hidden div to run the hook bodies,
 * which meant nothing inside a singleton hook could ever see context from the
 * app tree.
 *
 * This version keeps the same two-argument API, so no call site changed, but
 * runs the bodies inside the app's own tree via <SingletonHooks /> — mounted
 * once in main.tsx. One root, no hidden DOM, and the hooks can reach context
 * if they ever need to.
 *
 * The contract is unchanged: the body runs exactly once no matter how many
 * components call the hook, and callers get `initialValue` until the first
 * render of the body has committed.
 */

type Listener = () => void;

export interface Registration<T> {
  key: number;
  useBody: () => T;
  render: () => ReactElement;
}

let nextKey = 1;
export const registrations: Registration<unknown>[] = [];
const registryListeners = new Set<Listener>();

export function subscribeToRegistry(listener: Listener) {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

export function getRegistrySnapshot() {
  return registrations.length;
}

function notifyRegistry() {
  for (const listener of registryListeners) {
    listener();
  }
}

export function singletonHook<T>(initialValue: T, useBody: () => T): () => T {
  let current: T = initialValue;
  const listeners = new Set<Listener>();

  function publish(next: T) {
    // Object.is rather than !==, so a NaN state does not notify forever.
    if (Object.is(next, current)) {
      return;
    }
    current = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function Runner() {
    const next = useBody();

    // Layout effect, not effect: the value should be published before the
    // browser paints, so a consumer does not show the initial value for a
    // frame after the body has already produced the real one.
    useLayoutEffect(() => {
      publish(next);
    });

    return null;
  }

  const key = nextKey++;
  registrations.push({
    key,
    useBody: useBody as () => unknown,
    render: () => createElement(Runner, { key })
  });
  notifyRegistry();

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot() {
    return current;
  }

  return function useSingleton(): T {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };
}
