import { Slider, Switch } from "@gryt/ui";
import React from "react";

import { useLocale } from "../../../../lib/localeContext";
import { settingAnchorId,SETTINGS_INDEX } from "../hooks/settingsSearch";
import { useSettings } from "../hooks/useSettings";

/**
 * The colour advanced settings are titled in. Not the accent and not the warning
 * amber; cyan at step 11, which holds contrast in both themes.
 */
const ADVANCED_COLOR = "cyan" as const;

// Reusable wrapper components following DRY principles
interface SettingGroupProps {
  title: string;
  titleKey?: string;
  titleValue?: React.ReactNode;
  description: string;
  children: React.ReactNode;
  /**
   * Hidden unless the advanced toggle is on, and titled in a different colour
   * when it is, so it reads as "extra" rather than as something you skipped.
   */
  advanced?: boolean;
}

export function SettingGroup({ title, titleKey, titleValue, description, children, advanced }: SettingGroupProps) {
  const { showAdvanced } = useSettings();
  const { t } = useLocale();
  // Anchor for search results to scroll to. Derived from the title by the same
  // function the index uses, and it ignores any ": value" suffix.
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
      <span className="font-medium text-sm" color={advanced ? ADVANCED_COLOR : undefined}>{t(titleKey ?? title)}{titleValue != null && <>: {titleValue}</>}</span>
      <span className="text-xs text-gryt-muted">{t(description)}</span>
      {children}
    </div>
  );
}

interface SliderSettingProps {
  title: string;
  titleKey?: string;
  titleValue?: React.ReactNode;
  description: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function SliderSetting({ title, titleKey, titleValue, description, value, onChange, min = 0, max = 100, step = 1 }: SliderSettingProps) {
  return (
    <SettingGroup title={title} titleKey={titleKey} titleValue={titleValue} description={description}>
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
  titleKey?: string;
  titleValue?: React.ReactNode;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  statusText?: string;
  advanced?: boolean;
}

export function ToggleSetting({ title, titleKey, titleValue, description, checked, onCheckedChange, statusText, advanced }: ToggleSettingProps) {
  const { t } = useLocale();
  return (
    <SettingGroup title={title} titleKey={titleKey} titleValue={titleValue} description={description} advanced={advanced}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-gryt-muted">{t("settings.enableControl", { title: t(titleKey ?? title) })}</span>
          {statusText && (
            <span className="text-xs text-gryt-muted">{t(statusText)}</span>
          )}
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
    </SettingGroup>
  );
}

/** How long a jumped-to setting stays highlighted. */
export const HIGHLIGHT_MS = 1600;

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
