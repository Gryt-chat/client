import { Dialog, IconButton, Select, Switch, TextField } from "@gryt/ui";
import { useCallback, useMemo, useRef } from "react";
import { PiX } from "react-icons/pi";

import {
  type ChannelRule,
  CUSTOM_VALUE,
  describeRules,
  EVERYONE_VALUE,
} from "@/settings/src/channelPermissionRules";
import type { SidebarItem } from "@/settings/src/types/server";

import { ChannelPermissionMatrix } from "./ChannelPermissionMatrix";

export interface SidebarEditorFields {
  selectedSidebarItem: SidebarItem | null;
  sheetChannelName: string;
  setSheetChannelName: (v: string) => void;
  sheetChannelIsVoice: boolean;
  setSheetChannelIsVoice: (v: boolean) => void;
  sheetRequirePtt: boolean;
  setSheetRequirePtt: (v: boolean) => void;
  sheetDisableRnnoise: boolean;
  setSheetDisableRnnoise: (v: boolean) => void;
  sheetMaxBitrate: string;
  setSheetMaxBitrate: (v: string) => void;
  sheetEsportsMode: boolean;
  setSheetEsportsMode: (v: boolean) => void;
  sheetTextInVoice: boolean;
  setSheetTextInVoice: (v: boolean) => void;
  sheetScopeChoice: string;
  setSheetScopeChoice: (v: string) => void;
  sheetScopeRules: ChannelRule[];
  setSheetScopeRules: (v: ChannelRule[]) => void;
  scopeChoiceOptions: { label: string; value: string }[];
  scopeRoles: { id: string; name: string; rank: number; permissions: string[] }[];
  channelPermissions: string[];
  scopeLoading: boolean;
  saveChannelScope: (choice?: string, rules?: ChannelRule[]) => void;
  sheetSpacerHeight: string;
  setSheetSpacerHeight: (v: string) => void;
  sheetSeparatorLabel: string;
  setSheetSeparatorLabel: (v: string) => void;
  closeEditDialog: () => void;
  saveSelectedSidebarItem: () => void;
}

interface SidebarEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: SidebarEditorFields;
}

export const SidebarEditDialog = ({ open, onOpenChange, editor }: SidebarEditDialogProps) => {
  const {
    selectedSidebarItem,
    sheetChannelName, setSheetChannelName,
    sheetChannelIsVoice, setSheetChannelIsVoice,
    sheetRequirePtt, setSheetRequirePtt,
    sheetDisableRnnoise, setSheetDisableRnnoise,
    sheetMaxBitrate, setSheetMaxBitrate,
    sheetEsportsMode, setSheetEsportsMode,
    sheetTextInVoice, setSheetTextInVoice,
    sheetScopeChoice, setSheetScopeChoice,
    sheetScopeRules, setSheetScopeRules,
    scopeChoiceOptions, scopeRoles, channelPermissions, scopeLoading, saveChannelScope,
    sheetSpacerHeight, setSheetSpacerHeight,
    sheetSeparatorLabel, setSheetSeparatorLabel,
    closeEditDialog, saveSelectedSidebarItem,
  } = editor;

  const saveRef = useRef(saveSelectedSidebarItem);
  saveRef.current = saveSelectedSidebarItem;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; saveRef.current(); }, 600);
  }, []);

  const flushSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    saveRef.current();
  }, []);

  // The scope has its own save because it has its own event. Same debounce
  // shape as the channel fields, so a matrix that somebody clicks four times
  // sends once.
  const scopeSaveRef = useRef(saveChannelScope);
  scopeSaveRef.current = saveChannelScope;
  const scopeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* `rules` is threaded through the timer for the same reason the dropdown
     passes its choice: the matrix is only safe today because 600ms is long
     enough for a render, which is a timing argument rather than a guarantee. */
  const debouncedScopeSave = useCallback((rules?: ChannelRule[]) => {
    if (scopeTimerRef.current) clearTimeout(scopeTimerRef.current);
    scopeTimerRef.current = setTimeout(() => {
      scopeTimerRef.current = null;
      scopeSaveRef.current(undefined, rules);
    }, 600);
  }, []);

  const flushScopeSave = useCallback(() => {
    if (scopeTimerRef.current) clearTimeout(scopeTimerRef.current);
    scopeTimerRef.current = null;
    scopeSaveRef.current();
  }, []);

  /** Role id to name, for the sentence under the dropdown. */
  const roleNames = useMemo(
    () => new Map(scopeRoles.map((r) => [r.id, r.name])),
    [scopeRoles],
  );

  const handleClose = () => { flushSave(); flushScopeSave(); closeEditDialog(); };
  const handleKeyEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") handleClose(); };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Dialog.Title style={{ margin: 0 }}>
              {selectedSidebarItem?.kind === "channel" ? "Channel settings"
                : selectedSidebarItem?.kind === "separator" ? "Separator settings"
                : "Spacer settings"}
            </Dialog.Title>
            <Dialog.Close>
              <IconButton size="xsmall"><PiX size={16} /></IconButton>
            </Dialog.Close>
          </div>

          {selectedSidebarItem?.kind === "channel" && (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Name</span>
                <TextField
                  value={sheetChannelName}
                  onChange={(e) => setSheetChannelName(e.target.value)}
                  onBlur={flushSave}
                  onKeyDown={handleKeyEnter}
                  placeholder="Channel name"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Voice channel</span>
                <Switch checked={sheetChannelIsVoice} onCheckedChange={(v) => { setSheetChannelIsVoice(v); debouncedSave(); }} />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Who can use this channel</span>
                {/* Everyone, a shared template, or this channel's own rules.
                    A template is edited in server settings and applies to every
                    channel on it, which is the point — the dropdown only picks
                    one here. */}
                <Select
                  value={sheetScopeChoice || EVERYONE_VALUE}
                  disabled={scopeLoading}
                  onValueChange={(v) => {
                    /* Base UI hands back null when a Select clears, and
                       `String(null)` is the truthy string "null" — which the
                       server reads as a scope id it does not have. The role
                       editor shipped that once already. */
                    if (v === null || v === undefined) return;
                    const next = String(v);
                    setSheetScopeChoice(next);
                    /* The new value goes with the call. `scopeSaveRef.current`
                       is the closure the last render built, so a save in this
                       tick that reads state sends the choice being replaced. */
                    scopeSaveRef.current(next);
                  }}
                  options={scopeChoiceOptions}
                />
                <span className="text-xs">
                  {sheetScopeChoice === EVERYONE_VALUE
                    ? "Everyone on the server can see and use this channel."
                    : sheetScopeChoice === CUSTOM_VALUE
                      ? describeRules(sheetScopeRules, roleNames)
                      : "Follows a template. Change it in server settings and every channel using it changes with it."}
                </span>
                {sheetScopeChoice === CUSTOM_VALUE && (
                  <ChannelPermissionMatrix
                    roles={scopeRoles}
                    permissions={channelPermissions}
                    rules={sheetScopeRules}
                    disabled={scopeLoading}
                    onChange={(next) => {
                      setSheetScopeRules(next);
                      debouncedScopeSave(next);
                    }}
                  />
                )}
              </div>
              {sheetChannelIsVoice && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">eSports Mode</span>
                      <span className="text-xs">Lowest latency: PTT, no RNNoise, 128 kbps bitrate, 10ms Opus</span>
                    </div>
                    <Switch checked={sheetEsportsMode} onCheckedChange={(v) => {
                      setSheetEsportsMode(v);
                      if (v) { setSheetRequirePtt(true); setSheetDisableRnnoise(true); }
                      debouncedSave();
                    }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Require Push to Talk</span>
                      <span className="text-xs">Users must hold a key to transmit</span>
                    </div>
                    <Switch checked={sheetRequirePtt} onCheckedChange={(v) => { setSheetRequirePtt(v); debouncedSave(); }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Disable Noise Reduction</span>
                      <span className="text-xs">Raw audio with no processing for lower latency</span>
                    </div>
                    <Switch checked={sheetDisableRnnoise} disabled={sheetEsportsMode} onCheckedChange={(v) => { setSheetDisableRnnoise(v); debouncedSave(); }} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">Max Bitrate</span>
                    {/* The separator under Default is gone: the library's
                        Select takes a flat list of options, and Default reads
                        as the first of them well enough without a rule. */}
                    <Select
                      value={sheetMaxBitrate || "default"}
                      onValueChange={(v) => {
                        setSheetMaxBitrate(v === "default" ? "" : String(v));
                        debouncedSave();
                      }}
                      options={[
                        { label: "Default", value: "default" },
                        { label: "32 kbps", value: "32000" },
                        { label: "64 kbps", value: "64000" },
                        { label: "96 kbps", value: "96000" },
                        { label: "128 kbps", value: "128000" },
                        { label: "256 kbps", value: "256000" },
                        { label: "510 kbps", value: "510000" },
                      ]}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">Enable Text Chat</span>
                      <span className="text-xs">Allow text messages in this voice channel</span>
                    </div>
                    <Switch checked={sheetTextInVoice} onCheckedChange={(v) => { setSheetTextInVoice(v); debouncedSave(); }} />
                  </div>
                </>
              )}
            </>
          )}

          {selectedSidebarItem?.kind === "spacer" && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Height</span>
              <TextField
                value={sheetSpacerHeight}
                onChange={(e) => setSheetSpacerHeight(e.target.value)}
                onBlur={flushSave}
                onKeyDown={handleKeyEnter}
                placeholder="16"
              />
            </div>
          )}

          {selectedSidebarItem?.kind === "separator" && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Label</span>
              <TextField
                value={sheetSeparatorLabel}
                onChange={(e) => setSheetSeparatorLabel(e.target.value)}
                onBlur={flushSave}
                onKeyDown={handleKeyEnter}
                placeholder="Optional"
              />
            </div>
          )}
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
