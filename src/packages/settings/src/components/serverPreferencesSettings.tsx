import { Switch } from "@gryt/ui";

import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "./settingsComponents";

/** Preferences that affect how Gryt offers servers before you join them. */
export function ServerPreferencesSettings() {
  const { officialServerHidden, setOfficialServerHidden } = useSettings();

  return (
    <SettingsContainer>
      <h2 className="text-lg">Adding servers</h2>

      <SettingGroup
        title="The server we run"
        description="Gryt runs one server itself, and the dialog for adding a server offers it when you have nothing to paste. Turning this off hides that row for good on this device."
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={!officialServerHidden}
            onCheckedChange={(on) => setOfficialServerHidden(!on)}
          />
          Offer it when adding a server
        </label>
      </SettingGroup>
    </SettingsContainer>
  );
}
