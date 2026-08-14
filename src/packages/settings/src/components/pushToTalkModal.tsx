import { Button, Chip, Dialog } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { useSettings } from "@/settings";

function formatKeyCombo(combo: string): string {
  if (!combo) return "Not set";
  return combo
    .split("+")
    .map((part) => {
      switch (part) {
        case "Space": return "Space";
        case "Escape": return "Esc";
        default:
          if (part.startsWith("Key")) return part.slice(3);
          if (part.startsWith("Digit")) return part.slice(5);
          return part;
      }
    })
    .join(" + ");
}

function buildKeyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Meta");

  const modifierCodes = ["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"];
  if (!modifierCodes.includes(e.code)) {
    parts.push(e.code);
  }

  return parts.join("+");
}

export function PushToTalkModal() {
  const { inputMode, setInputMode, pushToTalkKey, setPushToTalkKey } = useSettings();
  const isOpen = inputMode === "push_to_talk" && !pushToTalkKey;

  const [captured, setCaptured] = useState("");

  useEffect(() => {
    if (isOpen) setCaptured("");
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") return;
      const combo = buildKeyCombo(e);
      if (combo) setCaptured(combo);
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, handleKeyDown]);

  const handleConfirm = () => {
    if (captured) {
      setPushToTalkKey(captured);
    }
  };

  const handleCancel = () => {
    setCaptured("");
    setInputMode("voice_activity");
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
        <Dialog.Title>Set Push to Talk Key</Dialog.Title>
        <Dialog.Description>
          Push to Talk is active but no key is bound. Press any key or combination to use as your PTT key.
        </Dialog.Description>

        <div className="flex flex-col gap-4 items-center py-4">
          <Chip tone="neutral"
            color={captured ? "green" : "blue"}
            style={{ fontFamily: "var(--code-font-family)", minWidth: "120px", textAlign: "center", padding: "8px 16px", fontSize: 16 }}
          >
            {captured ? formatKeyCombo(captured) : "Press a key..."}
          </Chip>

          {captured && (
            <span className="text-xs text-gryt-muted">
              Press a different key to change, or confirm below.
            </span>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <Button tone="neutral" size="small" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="small" onClick={handleConfirm} disabled={!captured}>
            Confirm
          </Button>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
