import { Button, Chip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { buildKeyCombo, buildMouseCombo, formatCombo } from "../../../../lib/hotkeys";
import { SettingGroup, SettingsContainer } from "./settingsComponents";

function HotkeyCapture({
  anchorId,
  label,
  description,
  value,
  onChange,
}: {
  anchorId: string;
  label: string;
  description: string;
  value: string;
  onChange: (key: string) => void;
}) {
  const { t: tr } = useTranslation();
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
    <SettingGroup anchorId={anchorId} title={label} description={description}>
      <div className="flex items-center justify-between gap-2">
        <Chip tone="neutral"
          color={listening ? "blue" : undefined}
          style={{ fontFamily: "var(--code-font-family)", minWidth: "80px", textAlign: "center" }}
        >
          {listening ? tr("ui.pressAKeyOrButton") : formatCombo(value)}
        </Chip>
        <div className="flex gap-2">
          <Button size="xsmall"
            onClick={() => setListening(!listening)}
          >
            {listening ? tr("ui.cancel") : tr("ui.edit")}
          </Button>
          {value && (
            <Button tone="danger" size="xsmall"
              onClick={() => onChange("")}
            >
              {tr("ui.clear")}
            </Button>
          )}
        </div>
      </div>
    </SettingGroup>
  );
}

export function HotkeySettings() {
  const { t: tr } = useTranslation();
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
      <h2 className="text-lg">{tr("ui.hotkeys")}</h2>

      <div className="flex flex-col gap-2">
        <span className="text-base font-bold">{tr("ui.shortcuts")}</span>
        <span className="text-xs text-gryt-muted">
          {tr("ui.bindAKeyOrTheMiddleOrA")}
        </span>
      </div>

      {inputMode === "push_to_talk" && (
        <HotkeyCapture
          anchorId="push-to-talk-key" label={tr("ui.pushToTalkKey")}
          description={tr("ui.holdThisKeyOrMouseButtonToTransmit")}
          value={pushToTalkKey}
          onChange={setPushToTalkKey}
        />
      )}

      <HotkeyCapture
        anchorId="toggle-mute" label={tr("ui.toggleMute")}
        description={tr("ui.toggleYourMicrophoneOnOrOff")}
        value={muteHotkey}
        onChange={setMuteHotkey}
      />

      <HotkeyCapture
        anchorId="toggle-deafen" label={tr("ui.toggleDeafen")}
        description={tr("ui.muteAllIncomingAudioAndYourMicrophone")}
        value={deafenHotkey}
        onChange={setDeafenHotkey}
      />

      <HotkeyCapture
        anchorId="disconnect" label={tr("ui.disconnect")}
        description={tr("ui.disconnectFromTheCurrentVoiceChannel")}
        value={disconnectHotkey}
        onChange={setDisconnectHotkey}
      />
    </SettingsContainer>
  );
}
