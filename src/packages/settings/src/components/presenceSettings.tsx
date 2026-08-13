
import { useSettings } from "@/settings";

import { SettingsContainer, SliderSetting } from "./settingsComponents";

/**
 * Presence, which is a behaviour rather than a device.
 *
 * This lived under Sound & video next to microphone gain and camera mirroring,
 * where it was the only control that changed nothing about either.
 */
export function PresenceSettings() {
  const { afkTimeoutMinutes, setAfkTimeoutMinutes } = useSettings();

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        Voice
      </h2>

      <SliderSetting
        title={`AFK timeout: ${afkTimeoutMinutes} minutes`}
        description="You are marked AFK after this many minutes of silence, and only while you are connected to voice."
        value={afkTimeoutMinutes}
        onChange={setAfkTimeoutMinutes}
        min={1}
        max={30}
      />
    </SettingsContainer>
  );
}
