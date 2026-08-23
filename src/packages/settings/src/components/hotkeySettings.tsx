import { Button, Chip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { useSettings } from "@/settings";

import { buildKeyCombo, buildMouseCombo, formatCombo } from "../../../../lib/hotkeys";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

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

  // Left and right click are not bindable, so they fall through and keep
  // working as clicks — including the click that starts the binding.
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      const combo = buildMouseCombo(e);
      if (!combo) return;
      e.preventDefault();
      e.stopPropagation();
      onChange(combo);
      setListening(false);
    },
    [onChange]
  );

  useEffect(() => {
    if (!listening) return;
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [listening, handleKeyDown, handleMouseDown]);

  return (
    <SettingGroup title={label} description={description}>
      <div className="flex items-center justify-between gap-2">
        <Chip tone="neutral"
          color={listening ? "blue" : undefined}
          style={{ fontFamily: "var(--code-font-family)", minWidth: "80px", textAlign: "center" }}
        >
          {listening ? "Press a key or button..." : formatCombo(value)}
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
          Bind a key, or the middle or a side mouse button. In the desktop app they work while
          Gryt is in the background. Press Escape to cancel binding.
        </span>
      </div>

      {inputMode === "push_to_talk" && (
        <HotkeyCapture
          label="Push to Talk Key"
          description="Hold this key or mouse button to transmit your microphone."
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
