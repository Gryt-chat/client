import { Button, Chip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "./settingsComponents";

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

function HotkeyCapture({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (key: string) => void;
}) {
  const [listening, setListening] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setListening(false);
        return;
      }
      const combo = buildKeyCombo(e);
      if (combo) {
        onChange(combo);
        setListening(false);
      }
    },
    [onChange]
  );

  useEffect(() => {
    if (!listening) return;
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [listening, handleKeyDown]);

  return (
    <SettingGroup title={label} description={description}>
      <div className="flex items-center justify-between gap-2">
        <Chip tone="neutral"
          color={listening ? "blue" : undefined}
          style={{ fontFamily: "var(--code-font-family)", minWidth: "80px", textAlign: "center" }}
        >
          {listening ? "Press a key..." : formatKeyCombo(value)}
        </Chip>
        <div className="flex gap-2">
          <Button size="xsmall"
            onClick={() => setListening(!listening)}
          >
            {listening ? "Cancel" : "Edit"}
          </Button>
          {value && (
            <Button tone="danger" size="xsmall"
              onClick={() => onChange("")}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </SettingGroup>
  );
}

export function HotkeySettings() {
  const {
    inputMode,
    pushToTalkKey,
    setPushToTalkKey,
    muteHotkey,
    setMuteHotkey,
    deafenHotkey,
    setDeafenHotkey,
    disconnectHotkey,
    setDisconnectHotkey,
  } = useSettings();

  return (
    <SettingsContainer>
      <h2 className="text-lg">Hotkeys</h2>

      <div className="flex flex-col gap-2">
        <span className="text-base font-bold">Shortcuts</span>
        <span className="text-xs text-gryt-muted">
          These shortcuts work globally when not typing in a text field. Press Escape to cancel binding.
        </span>
      </div>

      {inputMode === "push_to_talk" && (
        <HotkeyCapture
          label="Push to Talk Key"
          description="Hold this key to transmit your microphone."
          value={pushToTalkKey}
          onChange={setPushToTalkKey}
        />
      )}

      <HotkeyCapture
        label="Toggle mute"
        description="Toggle your microphone on or off."
        value={muteHotkey}
        onChange={setMuteHotkey}
      />

      <HotkeyCapture
        label="Toggle deafen"
        description="Mute all incoming audio and your microphone."
        value={deafenHotkey}
        onChange={setDeafenHotkey}
      />

      <HotkeyCapture
        label="Disconnect"
        description="Disconnect from the current voice channel."
        value={disconnectHotkey}
        onChange={setDisconnectHotkey}
      />
    </SettingsContainer>
  );
}
