import { Radio, RadioGroup, Select, Slider } from "@gryt/ui";
import { Flex, Heading, Text } from "@radix-ui/themes";
import { useMemo } from "react";

import { accentColors, grayColors, useTheme } from "@/common";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer } from "../settingsComponents";
import { TileLayoutPicker } from "../tileLayoutPicker";

/**
 * A colour control that names a colour without showing it makes you apply it
 * and look, then come back. Every option here is a Radix scale, so step 9 —
 * the solid step each scale is recognised by — is always available as a var.
 */
function ColorSwatch({ scale }: { scale: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        flexShrink: 0,
        background: `var(--${scale}-9)`,
        boxShadow: "inset 0 0 0 1px var(--gray-a5)",
      }}
    />
  );
}

export function AppearanceSettings() {
  const {
    appearancePreference,
    setAppearancePreference,
    accentColor,
    setAccentColor,
    grayColor,
    setGrayColor,
    radius,
    setRadius,
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

  const radiusOptions = useMemo(() => [
    { value: "none", label: "None" },
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
    { value: "full", label: "Full" },
  ], []);

  const { voiceTileLayout, setVoiceTileLayout } = useSettings();

  return (
    <SettingsContainer>
      <Heading size="4">Appearance</Heading>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Mode</Text>
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
      </Flex>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Accent color</Text>
        <Select
          value={accentColor}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onValueChange={(v) => setAccentColor(v as any)}
          options={accentColors.map((c) => ({
            value: c,
            label: (
              <Flex align="center" gap="2">
                <ColorSwatch scale={c} />
                {c}
              </Flex>
            ),
          }))}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Gray color</Text>
        <Select
          value={grayColor}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onValueChange={(v) => setGrayColor(v as any)}
          options={grayColors.map((c) => ({
            value: c,
            label: (
              <Flex align="center" gap="2">
                <ColorSwatch scale={c} />
                {c}
              </Flex>
            ),
          }))}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Rounded corners</Text>
        <Select
          value={radius}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onValueChange={(v) => setRadius(v as any)}
          options={radiusOptions.map((r) => ({ label: r.label, value: r.value }))}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Flex justify="between" align="center">
          <Text weight="medium" size="2">UI scale</Text>
          <Text size="1" color="gray">{Math.round(uiScale * 100)}%</Text>
        </Flex>
        <Slider
          min={50}
          max={200}
          step={10}
          value={Math.round(uiScale * 100)}
          onValueChange={(next) => setUiScale(Number(next) / 100)}
        />
        <Text size="1" color="gray">
          Ctrl+Plus / Ctrl+Minus to zoom, Ctrl+0 to reset
        </Text>
        {uiScale !== 1 && (
          <Text
            size="1"
            style={{ cursor: "pointer", width: "fit-content", color: "var(--accent-11)" }}
            onClick={resetZoom}
          >
            Reset to 100%
          </Text>
        )}
      </Flex>

      <Flex direction="column" gap="2">
        <Flex justify="between" align="center">
          <Text weight="medium" size="2">Chat font size</Text>
          <Text size="1" color="gray">{chatFontSize}px</Text>
        </Flex>
        <Slider
          min={10}
          max={24}
          step={1}
          value={chatFontSize}
          onValueChange={(next) => setChatFontSize(Number(next))}
        />
        <Text size="1" color="gray" style={{ fontSize: chatFontSize, lineHeight: 1.5 }}>
          Preview text at {chatFontSize}px
        </Text>
      </Flex>

      <Flex direction="column" gap="2">
        <Flex justify="between" align="center">
          <Text weight="medium" size="2">Standalone emoji size</Text>
          <Text size="1" color="gray">{emojiSize}px</Text>
        </Flex>
        <Slider
          min={12}
          max={96}
          step={4}
          value={emojiSize}
          onValueChange={(next) => setEmojiSize(Number(next))}
        />
        <Flex align="center" gap="2" pt="1">
          <Text size="1" color="gray">Preview:</Text>
          <span style={{ fontSize: emojiSize, lineHeight: 1.25 }}>😀</span>
        </Flex>
      </Flex>

      <SettingGroup
        title="Tile layout"
        description="How the voice grid arranges people once it is maximised or fullscreen. Both were measured against Google Meet; which you prefer is a matter of taste. The sidebar looks the same either way."
      >
        <TileLayoutPicker value={voiceTileLayout} onChange={setVoiceTileLayout} />


      </SettingGroup>
    </SettingsContainer>
  );
}


