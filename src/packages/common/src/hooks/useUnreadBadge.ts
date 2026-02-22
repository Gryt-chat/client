import { useCallback, useEffect, useRef } from "react";

let unreadCount = 0;
let windowFocused = document.hasFocus();

function setBadge(count: number) {
  unreadCount = count;
  window.electronAPI?.setBadgeCount(count);
}

function setupFocusListeners() {
  const onFocus = () => {
    windowFocused = true;
    setBadge(0);
  };
  const onBlur = () => {
    windowFocused = false;
  };

  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);

  const cleanupElectron = window.electronAPI?.onWindowFocusChange((focused) => {
    windowFocused = focused;
    if (focused) setBadge(0);
  });

  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    cleanupElectron?.();
  };
}

let teardown: (() => void) | null = null;

function ensureListeners() {
  if (!teardown) {
    teardown = setupFocusListeners();
  }
}

export function useUnreadBadge() {
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    ensureListeners();
    return () => { mounted.current = false; };
  }, []);

  const incrementUnread = useCallback(() => {
    if (windowFocused) return;
    setBadge(unreadCount + 1);
  }, []);

  return { incrementUnread };
}
