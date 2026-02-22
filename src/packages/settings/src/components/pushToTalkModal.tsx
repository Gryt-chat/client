import { Badge, Button, Dialog, Flex, Text } from "@radix-ui/themes";
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
      <Dialog.Content maxWidth="420px">
        <Dialog.Title>Set Push to Talk Key</Dialog.Title>
        <Dialog.Description size="2" mb="4">
          Push to Talk is active but no key is bound. Press any key or combination to use as your PTT key.
        </Dialog.Description>

        <Flex direction="column" gap="4" align="center" py="4">
          <Badge
            size="2"
            variant="surface"
            color={captured ? "green" : "blue"}
            style={{ fontFamily: "var(--code-font-family)", minWidth: "120px", textAlign: "center", padding: "8px 16px", fontSize: 16 }}
          >
            {captured ? formatKeyCombo(captured) : "Press a key..."}
          </Badge>

          {captured && (
            <Text size="1" color="gray">
              Press a different key to change, or confirm below.
            </Text>
          )}
        </Flex>

        <Flex gap="3" justify="end">
          <Button variant="soft" color="gray" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!captured}>
            Confirm
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
