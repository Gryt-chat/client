import { Radio, RadioGroup, Slider } from "@gryt/ui";
import { useMemo } from "react";

import { useTheme } from "@/common";
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
  } = useSettings();

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
          radius — built on ui.gryt.chat and carried here as a link. */}
      <SettingGroup
        title="Theme"
        description="Build one on ui.gryt.chat, press Copy link, and paste it here. A theme is a couple of dozen hex values, so a link is the whole thing."
      >
        <ThemeLibrary />
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
        description="How the voice grid arranges people once it is maximised. Both were measured against Google Meet; which you prefer is a matter of taste. The sidebar looks the same either way."
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


