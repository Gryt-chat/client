import { Select } from "@gryt/ui";

import { type ChannelRule, CUSTOM_VALUE, EVERYONE_VALUE } from "@/settings/src/channelPermissionRules";

import { ChannelPermissionMatrix } from "./ChannelPermissionMatrix";

interface ScopePickerProps {
  choice: string;
  rules: ChannelRule[];
  options: { label: string; value: string }[];
  roles: { id: string; name: string; rank: number; permissions: string[] }[];
  permissions: string[];
  loading: boolean;
  /** The sentence under the dropdown, for whatever is picked. */
  description: string;
  /** Show the matrix greyed out: what a channel follows, which is edited on the folder. */
  lockedMatrix?: boolean;
  onChoice: (value: string) => void;
  onRules: (rules: ChannelRule[]) => void;
}

/** Everyone, a template or rules of its own, for a channel or a folder. Saving is
    the caller's, so one debounce in the dialog covers both. */
export function ScopePicker({
  choice,
  rules,
  options,
  roles,
  permissions,
  loading,
  description,
  lockedMatrix = false,
  onChoice,
  onRules,
}: ScopePickerProps) {
  return (
    <>
      <Select
        value={choice || EVERYONE_VALUE}
        disabled={loading}
        onValueChange={(v) => {
          /* Base UI hands back null when a Select clears, and
             `String(null)` is the truthy string "null". */
          if (v === null || v === undefined) return;
          onChoice(String(v));
        }}
        options={options}
      />
      <span className="text-xs">{description}</span>
      {(choice === CUSTOM_VALUE || lockedMatrix) && (
        <ChannelPermissionMatrix
          roles={roles}
          permissions={permissions}
          rules={rules}
          disabled={loading || lockedMatrix}
          onChange={onRules}
        />
      )}
    </>
  );
}
