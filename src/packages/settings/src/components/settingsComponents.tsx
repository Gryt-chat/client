import { Flex, Slider, Switch, Text } from "@radix-ui/themes";
import React from "react";

import { settingAnchorId,SETTINGS_INDEX } from "../hooks/settingsSearch";

// Reusable wrapper components following DRY principles
interface SettingGroupProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function SettingGroup({ title, description, children }: SettingGroupProps) {
  // Anchor for search results to scroll to. Derived from the title by the same
  // function the index uses, so the two cannot drift apart — and it ignores any
  // ": value" suffix, so it stays put as the value changes.
  const anchor = settingAnchorId(title);

  if (import.meta.env.DEV) {
    // A setting the index doesn't know about is invisible to search. Warn
    // rather than fail: a missing entry shouldn't stop the panel rendering.
    if (!SETTINGS_INDEX.some((entry) => entry.id === anchor)) {
      console.warn(
        `[settings] "${title}" (${anchor}) is not in SETTINGS_INDEX — it won't be findable by search.`,
      );
    }
  }

  return (
    <Flex direction="column" gap="2" id={anchor} data-setting={anchor}>
      <Text weight="medium" size="2">{title}</Text>
      <Text size="1" color="gray">{description}</Text>
      {children}
    </Flex>
  );
}

interface SliderSettingProps {
  title: string;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function SliderSetting({ title, description, value, onChange, min = 0, max = 100, step = 1 }: SliderSettingProps) {
  return (
    <SettingGroup title={title} description={description}>
      <Slider
        value={[value]}
        onValueChange={(value) => onChange(value[0])}
        max={max}
        min={min}
        step={step}
      />
    </SettingGroup>
  );
}

interface ToggleSettingProps {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  statusText?: string;
}

export function ToggleSetting({ title, description, checked, onCheckedChange, statusText }: ToggleSettingProps) {
  return (
    <SettingGroup title={title} description={description}>
      <Flex align="center" justify="between">
        <Flex direction="column" gap="1">
          <Text size="2" color="gray">Enable {title}</Text>
          {statusText && (
            <Text size="1" color="gray">{statusText}</Text>
          )}
        </Flex>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </Flex>
    </SettingGroup>
  );
}

// Global settings container with consistent spacing
interface SettingsContainerProps {
  children: React.ReactNode;
}

export function SettingsContainer({ children }: SettingsContainerProps) {
  return (
    <Flex direction="column" gap="6" pb="4">
      {children}
    </Flex>
  );
}
