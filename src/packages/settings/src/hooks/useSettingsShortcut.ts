import { useEffect } from "react";

import { useSettings } from "./useSettings";

/**
 * Cmd/Ctrl + , toggles the settings modal. Matches on e.code so it survives
 * layouts that put comma elsewhere; safe in a text field, it produces no text.
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
