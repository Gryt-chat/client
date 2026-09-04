import { useEffect } from "react";

import { useSettings } from "./useSettings";

/**
 * Cmd + , on macOS, Ctrl + , everywhere else — toggles the settings modal.
 *
 * Matches on e.code rather than e.key so it survives keyboard layouts that put
 * comma somewhere else.
 *
 * Fires even while a text field has focus, the same as useZoomShortcuts. Safe
 * because the combination produces no text. It stays quiet while the
 * push-to-talk capture modal is open without needing a check here: that modal
 * listens in the capture phase and calls stopPropagation, so this bubble-phase
 * listener never sees the event.
 */
export function useSettingsShortcut() {
  const { showSettings, setShowSettings } = useSettings();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      if (e.code !== "Comma") return;

      e.preventDefault();
      setShowSettings(!showSettings);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettings, setShowSettings]);
}
