import { Slider, Switch } from "@gryt/ui";
import React from "react";

import { settingAnchorId,SETTINGS_INDEX } from "../hooks/settingsSearch";
import { useSettings } from "../hooks/useSettings";

/**
 * The colour advanced settings are titled in.
 *
 * Not the accent, which belongs to things you are meant to click, and not the
 * amber used for warnings — nothing here is dangerous, it is just further in.
 * Cyan at step 11, which is Radix's accessible-text step, so it holds contrast
 * against the panel in both themes.
 */
const ADVANCED_COLOR = "cyan" as const;

// Reusable wrapper components following DRY principles
interface SettingGroupProps {
  title: string;
  description: string;
  children: React.ReactNode;
  /**
   * Hidden unless the advanced toggle is on, and titled in a different colour
   * when it is, so it reads as "extra" rather than as something you skipped.
   */
  advanced?: boolean;
}

export function SettingGroup({ title, description, children, advanced }: SettingGroupProps) {
  const { showAdvanced } = useSettings();
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

  // Rendered nowhere rather than hidden with CSS, so search cannot find a
  // setting the panel is not currently offering.
  if (advanced && !showAdvanced) return null;

  return (
    <div className="flex flex-col gap-2" id={anchor} data-setting={anchor} data-advanced={advanced || undefined}>
      <span className="font-medium text-sm" color={advanced ? ADVANCED_COLOR : undefined}>{title}</span>
      <span className="text-xs text-gryt-muted">{description}</span>
      {children}
    </div>
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
        value={value}
        onValueChange={(next) => onChange(Number(next))}
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
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-gryt-muted">Enable {title}</span>
          {statusText && (
            <span className="text-xs text-gryt-muted">{statusText}</span>
          )}
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </SettingGroup>
  );
}

// Global settings container with consistent spacing
interface SettingsContainerProps {
  children: React.ReactNode;
}

export function SettingsContainer({ children }: SettingsContainerProps) {
  return (
    <div className="flex flex-col gap-8 pb-4">
      {children}
    </div>
  );
}
