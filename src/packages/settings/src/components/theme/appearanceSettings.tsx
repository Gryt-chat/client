import { Button, Radio, RadioGroup, Switch } from "@gryt/ui";
import { grytDraft } from "@gryt/ui";
import { PencilSimple } from "@phosphor-icons/react";
import { useMemo } from "react";

import { useCustomThemes, useTheme, useThemeEditor } from "@/common";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "../settingsComponents";
import { ThemeLibrary } from "./themeLibrary";

/**
 * The mode and the palette. A control that names a colour without showing it
 * makes you apply it and look, so the theme list draws each one.
 */
export function ThemeSettings() {
  const { appearancePreference, setAppearancePreference } = useTheme();

  const appearanceOptions = useMemo(() => [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ], []);

  const {
    googleFontsEnabled,
    setGoogleFontsEnabled,
    officialServerHidden,
    setOfficialServerHidden,
  } = useSettings();

  const { activeTheme } = useCustomThemes();
  const { openEditor } = useThemeEditor();

  return (
    <SettingsContainer>
      <h2 className="text-lg">Theme</h2>

      <div className="flex flex-col gap-2">
        <span className="font-medium text-sm">Mode</span>
        <RadioGroup
          value={appearancePreference}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onValueChange={(v) => setAppearancePreference(v as any)}
        >
          {appearanceOptions.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Radio value={o.value} />
              {o.label}
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Where the accent, gray and radius dropdowns used to be. Those set
          Radix Themes' props, and one of them could change one thing. A theme
          is the whole palette — every anchor, both appearances, the corner
          radius. */}
      <SettingGroup
        title="Theme"
        description="Pick one, or open the editor and change it while you use the app. A theme is a couple of dozen hex values, so a link is the whole thing — paste one somebody sent you, or send yours."
      >
        <ThemeLibrary />
        {/* Opens on whatever is being worn, so the first thing the editor
            shows is the app as it is rather than a palette nobody chose. With
            nothing custom applied that is the library's own, which is what
            grytDraft is. */}
        <div className="pt-2">
          <Button
            onClick={() => openEditor(activeTheme ?? grytDraft)}
            size="small"
            tone="neutral"
          >
            <PencilSimple aria-hidden="true" size={15} />
            Open editor
          </Button>
          <p className="m-0 pt-2 text-xs text-gryt-muted">
            The editor floats over Gryt and follows every change as you make
            it. Drag it out of the way to see what a colour does to the part
            underneath.
          </p>
        </div>
      </SettingGroup>

      {/* The only way back once somebody presses "Hide forever" in the
          add-server dialog. That control removes the row completely rather than
          leaving a smaller one behind — a suggestion you have declined should
          stop being on screen — so the undo has to live somewhere it can be
          found on purpose, and a preference about what the UI offers belongs
          with the rest of them. */}
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

      {/* Under Theme, because it is a thing about themes rather than about
          privacy in general — somebody arrives here having picked a font in
          the editor and been told it will not load. */}
      <SettingGroup
        title="Typefaces from Google"
        description="A theme can name any typeface. Turning this on lets Gryt fetch the ones that are not already on this machine from fonts.google.com, which means Google sees your address and that you are running Gryt. Off, a theme that names one of those falls back to a face you already have."
      >
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <Switch
            checked={googleFontsEnabled}
            onCheckedChange={setGoogleFontsEnabled}
          />
          Enable Google Fonts
        </label>
      </SettingGroup>

    </SettingsContainer>
  );
}


