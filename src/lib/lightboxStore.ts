/** One image lightbox for the whole app, for a picture opened from somewhere that closes under it, like a hover card. */

import { useSyncExternalStore } from "react";

export interface LightboxImage {
  src: string;
  alt?: string;
}

let current: LightboxImage | null = null;
const listeners = new Set<() => void>();

export function openLightbox(image: LightboxImage): void {
  current = image;
  listeners.forEach((fn) => fn());
}

export function closeLightbox(): void {
  current = null;
  listeners.forEach((fn) => fn());
}

export function useLightboxImage(): LightboxImage | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}
