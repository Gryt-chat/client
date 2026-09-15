import { Select, type SelectOption } from "@gryt/ui";
import type { Icon } from "@phosphor-icons/react";

export interface SettingsPickerOption {
  value: string;
  label: string;
  icon: Icon;
}

/** A category and its pages, the way the user settings rail nests them. */
export interface SettingsPickerGroup {
  label: string;
  options: SettingsPickerOption[];
}

function toSelectOption({ value, label, icon: Icon }: SettingsPickerOption): SelectOption {
  return {
    value,
    label: (
      <span className="flex items-center gap-2">
        <Icon size={16} />
        {label}
      </span>
    ),
  };
}

/** A settings dialog's tab rail as one Select, for a window too narrow to keep the rail beside the page. */
export function SettingsPicker({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: (SettingsPickerOption | SettingsPickerGroup)[];
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onValueChange(String(v))}
      options={options.map((option) =>
        "options" in option
          ? { label: option.label, options: option.options.map(toSelectOption) }
          : toSelectOption(option),
      )}
    />
  );
}
