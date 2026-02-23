import { useEffect } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (el as HTMLElement).isContentEditable;
}

function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  if (!hotkey) return false;
  const parts = hotkey.split("+");
  const key = parts[parts.length - 1];
  const needsCtrl = parts.includes("Ctrl");
  const needsShift = parts.includes("Shift");
  const needsAlt = parts.includes("Alt");
  const needsMeta = parts.includes("Meta");

  return (
    e.code === key &&
    e.ctrlKey === needsCtrl &&
    e.shiftKey === needsShift &&
    e.altKey === needsAlt &&
    e.metaKey === needsMeta
  );
}

export function useGlobalHotkeys(onDisconnect?: () => void) {
  const {
    isMuted,
    setIsMuted,
    isDeafened,
    setIsDeafened,
    isServerMuted,
    isServerDeafened,
    muteHotkey,
    deafenHotkey,
    disconnectHotkey,
  } = useSettings();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isInputFocused()) return;

      if (matchesHotkey(e, muteHotkey)) {
        e.preventDefault();
        if (isServerMuted) {
          toast("You are server muted by an admin.", { icon: "🔇", id: "server-muted" });
          return;
        }
        setIsMuted(!isMuted);
        return;
      }

      if (matchesHotkey(e, deafenHotkey)) {
        e.preventDefault();
        if (isServerDeafened) {
          toast("You are server deafened by an admin.", { icon: "🔇", id: "server-deafened" });
          return;
        }
        setIsDeafened(!isDeafened);
        return;
      }

      if (matchesHotkey(e, disconnectHotkey) && onDisconnect) {
        e.preventDefault();
        onDisconnect();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    muteHotkey,
    deafenHotkey,
    disconnectHotkey,
    isMuted,
    isDeafened,
    isServerMuted,
    isServerDeafened,
    setIsMuted,
    setIsDeafened,
    onDisconnect,
  ]);
}
