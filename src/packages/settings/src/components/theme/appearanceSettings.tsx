import { Radio, RadioGroup, Slider } from "@gryt/ui";
import { useMemo } from "react";

import { useTheme } from "@/common";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "../settingsComponents";
import { TileLayoutPicker } from "../tileLayoutPicker";

/**
 * A colour control that names a colour without showing it makes you apply it
 * and look, then come back. Every option here is a Radix scale, so step 9 —
 * the solid step each scale is recognised by — is always available as a var.
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

  const { voiceTileLayout, setVoiceTileLayout } = useSettings();

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

      {/* The accent, gray and radius pickers are gone with Radix Themes. They
          set that library's theme props, and the palette is @gryt/ui's now —
          one look rather than a themeable one. An addon can still replace the
          whole palette through createGrytTheme, which is a better fit for
          "make Gryt look different" than three dropdowns were. */}

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
    </SettingsContainer>
  );
}


