import { Flex, Heading, RadioGroup, Select, Slider, Text } from "@radix-ui/themes";
import { useMemo } from "react";

import { accentColors, grayColors, useTheme } from "@/common";

import { SettingsContainer } from "../settingsComponents";

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

  return (
    <SettingsContainer>
      <Heading size="4">Appearance</Heading>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Mode</Text>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <RadioGroup.Root value={appearancePreference} onValueChange={(v) => setAppearancePreference(v as any)}>
          {appearanceOptions.map(o => (
            <RadioGroup.Item key={o.value} value={o.value}>{o.label}</RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </Flex>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Accent color</Text>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Select.Root value={accentColor} onValueChange={(v) => setAccentColor(v as any)}>
          <Select.Trigger />
          <Select.Content>
            {accentColors.map(c => (
              <Select.Item key={c} value={c}>{c}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Gray color</Text>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Select.Root value={grayColor} onValueChange={(v) => setGrayColor(v as any)}>
          <Select.Trigger />
          <Select.Content>
            {grayColors.map(c => (
              <Select.Item key={c} value={c}>{c}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Rounded corners</Text>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Select.Root value={radius} onValueChange={(v) => setRadius(v as any)}>
          <Select.Trigger />
          <Select.Content>
            {radiusOptions.map(r => (
              <Select.Item key={r.value} value={r.value}>{r.label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
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
          value={[emojiSize]}
          onValueChange={([v]) => setEmojiSize(v)}
        />
        <Flex align="center" gap="2" pt="1">
          <Text size="1" color="gray">Preview:</Text>
          <span style={{ fontSize: emojiSize, lineHeight: 1.25 }}>😀</span>
        </Flex>
      </Flex>

    </SettingsContainer>
  );
}


