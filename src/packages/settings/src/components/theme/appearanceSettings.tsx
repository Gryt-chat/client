import { Button, Radio, RadioGroup, Slider, Switch } from "@gryt/ui";
import { grytDraft } from "@gryt/ui";
import { PencilSimple } from "@phosphor-icons/react";
import { useMemo } from "react";

import { useCustomThemes, useTheme, useThemeEditor } from "@/common";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "../settingsComponents";
import { TileLayoutPicker } from "../tileLayoutPicker";
import { TwoPersonLayoutPicker } from "../twoPersonLayoutPicker";
import { ThemeLibrary } from "./themeLibrary";

/**
 * Everything about how Gryt looks, in the order somebody reaches for it: the
 * mode first, then the palette, then how big everything is.
 *
 * A control that names a colour without showing it makes you apply it and look,
 * then come back — which is why the theme list draws each one rather than
 * listing its name, and why importing a theme shows it on real components
 * before it is saved.
 */
export function AppearanceSettings() {
  const {
    appearancePreference,
    setAppearancePreference,
    emojiSize,
    setEmojiSize,
    chatFontSize,
    setChatFontSize,
    uiScale,
    setUiScale,
    resetZoom,
  } = useTheme();

  const appearanceOptions = useMemo(() => [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ], []);

  const {
    voiceTileLayout,
    setVoiceTileLayout,
    voiceTwoPersonLayout,
    setVoiceTwoPersonLayout,
    googleFontsEnabled,
    setGoogleFontsEnabled,
  } = useSettings();

  const { activeTheme } = useCustomThemes();
  const { openEditor } = useThemeEditor();

  return (
    <SettingsContainer>
      <h2 className="text-lg">Appearance</h2>

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

      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="font-medium text-sm">UI scale</span>
          <span className="text-xs text-gryt-muted">{Math.round(uiScale * 100)}%</span>
        </div>
        <Slider
          min={50}
          max={200}
          step={10}
          value={Math.round(uiScale * 100)}
          onValueChange={(next) => setUiScale(Number(next) / 100)}
        />
        <span className="text-xs text-gryt-muted">
          Ctrl+Plus / Ctrl+Minus to zoom, Ctrl+0 to reset
        </span>
        {uiScale !== 1 && (
          <span className="text-xs" style={{ cursor: "pointer", width: "fit-content", color: "var(--gryt-accent-11)" }} onClick={resetZoom}>
            Reset to 100%
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="font-medium text-sm">Chat font size</span>
          <span className="text-xs text-gryt-muted">{chatFontSize}px</span>
        </div>
        <Slider
          min={10}
          max={24}
          step={1}
          value={chatFontSize}
          onValueChange={(next) => setChatFontSize(Number(next))}
        />
        <span className="text-xs text-gryt-muted" style={{ fontSize: chatFontSize, lineHeight: 1.5 }}>
          Preview text at {chatFontSize}px
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-center">
          <span className="font-medium text-sm">Standalone emoji size</span>
          <span className="text-xs text-gryt-muted">{emojiSize}px</span>
        </div>
        <Slider
          min={12}
          max={96}
          step={4}
          value={emojiSize}
          onValueChange={(next) => setEmojiSize(Number(next))}
        />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-gryt-muted">Preview:</span>
          <span style={{ fontSize: emojiSize, lineHeight: 1.25 }}>😀</span>
        </div>
      </div>

      <SettingGroup
        title="Tile layout"
        description="How the voice grid arranges people once it is maximised or fullscreen. Both were measured against Google Meet; which you prefer is a matter of taste. The sidebar looks the same either way."
      >
        <TileLayoutPicker value={voiceTileLayout} onChange={setVoiceTileLayout} />


      </SettingGroup>

      <SettingGroup
        title="Two people"
        description="With exactly two of you in a channel and nobody sharing a screen. One large and one small is what a video call usually does; same size is better when you are both doing something rather than talking to each other."
      >
        <TwoPersonLayoutPicker
          value={voiceTwoPersonLayout}
          onChange={setVoiceTwoPersonLayout}
          rule={voiceTileLayout}
        />
      </SettingGroup>
    </SettingsContainer>
  );
}


