import { Dialog, IconButton, Select, Switch, TextField } from "@gryt/ui";
import { useCallback, useMemo, useRef } from "react";

import type { NotificationLevel } from "@/common";
import {
  type ChannelRule,
  CUSTOM_VALUE,
  describeRules,
  EVERYONE_VALUE,
} from "@/settings/src/channelPermissionRules";
import {
  describeFolderRules,
  folderFollowNote,
  FOLLOW_FOLDER_VALUE,
  followFolderLabel,
  followingFolderDescription,
} from "@/settings/src/folderPermissionRules";
import type { SidebarItem } from "@/settings/src/types/server";

import { PiX } from "../../../../lib/icons";
import { type ChannelKind, NOTIFICATION_LEVEL_OPTIONS } from "./channelKind";
import { ChannelKindPicker } from "./ChannelKindPicker";
import { type ForumTagDraft, ForumTagsField } from "./ForumTagsField";
import { ScopePicker } from "./ScopePicker";
import { settingsTitle } from "./sidebarTree";

export interface SidebarEditorFields {
  selectedSidebarItem: SidebarItem | null;
  sheetChannelName: string;
  setSheetChannelName: (v: string) => void;
  sheetChannelIsVoice: boolean;
  setSheetChannelIsVoice: (v: boolean) => void;
  sheetChannelKind: ChannelKind;
  setSheetChannelKind: (v: ChannelKind) => void;
  sheetForumTags: ForumTagDraft[];
  setSheetForumTags: (v: ForumTagDraft[]) => void;
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
  sheetDefaultNotificationLevel: NotificationLevel;
  setSheetDefaultNotificationLevel: (v: NotificationLevel) => void;
  sheetScopeChoice: string;
  setSheetScopeChoice: (v: string) => void;
  sheetScopeRules: ChannelRule[];
  setSheetScopeRules: (v: ChannelRule[]) => void;
  scopeChoiceOptions: { label: string; value: string }[];
  scopeRoles: { id: string; name: string; rank: number; permissions: string[] }[];
  channelPermissions: string[];
  scopeLoading: boolean;
  saveScope: (choice?: string, rules?: ChannelRule[]) => void;
  sheetScopeFolder: { id: string; name: string | null } | null;
  sheetScopeFollowsFolder: boolean;
  followFolder: () => void;
  folderPermissions: boolean;
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
    sheetChannelKind, setSheetChannelKind,
    sheetForumTags, setSheetForumTags,
    sheetRequirePtt, setSheetRequirePtt,
    sheetDisableRnnoise, setSheetDisableRnnoise,
    sheetMaxBitrate, setSheetMaxBitrate,
    sheetEsportsMode, setSheetEsportsMode,
    sheetTextInVoice, setSheetTextInVoice,
    sheetDefaultNotificationLevel, setSheetDefaultNotificationLevel,
    sheetScopeChoice, setSheetScopeChoice,
    sheetScopeRules, setSheetScopeRules,
    scopeChoiceOptions, scopeRoles, channelPermissions, scopeLoading, saveScope,
    sheetScopeFolder, sheetScopeFollowsFolder, followFolder, folderPermissions,
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

  // The scope has its own save because it has its own event. Same debounce shape
  // as the channel fields, so a matrix clicked four times sends once.
  const scopeSaveRef = useRef(saveScope);
  scopeSaveRef.current = saveScope;
  const scopeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScopeRulesRef = useRef<ChannelRule[] | undefined>(undefined);

  /* `rules` is threaded through the timer for the same reason the dropdown passes
     its choice: 600ms being long enough for a render is timing, not a guarantee. */
  const debouncedScopeSave = useCallback((rules?: ChannelRule[]) => {
    if (scopeTimerRef.current) clearTimeout(scopeTimerRef.current);
    pendingScopeRulesRef.current = rules;
    scopeTimerRef.current = setTimeout(() => {
      scopeTimerRef.current = null;
      scopeSaveRef.current(undefined, rules);
    }, 600);
  }, []);

  /* Only a save still waiting. Saving on every close made a channel that follows
     its folder its own, and reset one to Everyone if closed before it loaded. */
  const flushScopeSave = useCallback(() => {
    if (!scopeTimerRef.current) return;
    clearTimeout(scopeTimerRef.current);
    scopeTimerRef.current = null;
    scopeSaveRef.current(undefined, pendingScopeRulesRef.current);
  }, []);

  const cancelScopeSave = useCallback(() => {
    if (scopeTimerRef.current) clearTimeout(scopeTimerRef.current);
    scopeTimerRef.current = null;
  }, []);

  const pickScope = (next: string) => {
    setSheetScopeChoice(next);
    /* The new value goes with the call: `scopeSaveRef.current` is
       the closure the last render built. */
    scopeSaveRef.current(next);
  };

  /* Only a channel in a folder gets Follow folder, and it is first because it is
     what a new channel there does. */
  const following = Boolean(sheetScopeFolder) && sheetScopeFollowsFolder;
  const channelScopeOptions = sheetScopeFolder
    ? [{ label: followFolderLabel(sheetScopeFolder.name), value: FOLLOW_FOLDER_VALUE }, ...scopeChoiceOptions]
    : scopeChoiceOptions;

  const pickChannelScope = (next: string) => {
    if (next !== FOLLOW_FOLDER_VALUE) return pickScope(next);
    if (following) return;
    cancelScopeSave();
    followFolder();
  };

  const drawRules = (next: ChannelRule[]) => {
    setSheetScopeRules(next);
    debouncedScopeSave(next);
  };

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
              {settingsTitle(selectedSidebarItem?.kind)}
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
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Channel type</span>
                <ChannelKindPicker
                  value={sheetChannelKind}
                  onChange={(k) => {
                    setSheetChannelKind(k);
                    // Kept in step because the voice-only block below still reads it.
                    setSheetChannelIsVoice(k === "voice");
                    debouncedSave();
                  }}
                />
              </div>
              {sheetChannelKind === "forum" && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium">Tags</span>
                  <ForumTagsField
                    tags={sheetForumTags}
                    onChange={(t) => { setSheetForumTags(t); debouncedSave(); }}
                  />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Default notifications</span>
                <Select
                  value={sheetDefaultNotificationLevel}
                  onValueChange={(v) => {
                    if (v !== "all" && v !== "mentions" && v !== "none") return;
                    setSheetDefaultNotificationLevel(v);
                    debouncedSave();
                  }}
                  options={NOTIFICATION_LEVEL_OPTIONS}
                />
                <span className="text-xs">
                  What members get from this channel until they pick their own level for it.
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Who can use this channel</span>
                {sheetScopeFolder && !sheetScopeFollowsFolder && (
                  <span className="text-xs">{folderFollowNote(sheetScopeFolder.name)}</span>
                )}
                <ScopePicker
                  choice={following ? FOLLOW_FOLDER_VALUE : sheetScopeChoice}
                  rules={sheetScopeRules}
                  options={channelScopeOptions}
                  roles={scopeRoles}
                  permissions={channelPermissions}
                  loading={scopeLoading}
                  lockedMatrix={following && sheetScopeChoice === CUSTOM_VALUE}
                  description={
                    following
                      ? followingFolderDescription(
                          sheetScopeFolder?.name ?? null,
                          sheetScopeRules,
                          roleNames,
                          sheetScopeChoice !== EVERYONE_VALUE && sheetScopeChoice !== CUSTOM_VALUE
                            ? scopeChoiceOptions.find((o) => o.value === sheetScopeChoice)?.label ?? null
                            : null,
                        )
                      : sheetScopeChoice === EVERYONE_VALUE
                        ? "Everyone on the server can see and use this channel."
                        : sheetScopeChoice === CUSTOM_VALUE
                          ? describeRules(sheetScopeRules, roleNames)
                          : "Follows a template. Change it in server settings and every channel using it changes with it."
                  }
                  onChoice={pickChannelScope}
                  onRules={drawRules}
                />
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

          {(selectedSidebarItem?.kind === "separator" || selectedSidebarItem?.kind === "folder") && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                {selectedSidebarItem.kind === "folder" ? "Name" : "Label"}
              </span>
              <TextField
                value={sheetSeparatorLabel}
                onChange={(e) => setSheetSeparatorLabel(e.target.value)}
                onBlur={flushSave}
                onKeyDown={handleKeyEnter}
                /* A separator with no label is a plain rule, which is reasonable
                   to want. A folder with no name is a row you cannot tell apart. */
                placeholder={selectedSidebarItem.kind === "folder" ? "New folder" : "Optional"}
              />
            </div>
          )}

          {selectedSidebarItem?.kind === "folder" && folderPermissions && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Who can use this folder</span>
              <span className="text-xs">
                Channels in this folder follow these permissions unless they have their own.
                If someone can&rsquo;t see any of its channels, they won&rsquo;t see the folder either.
              </span>
              <ScopePicker
                choice={sheetScopeChoice}
                rules={sheetScopeRules}
                options={scopeChoiceOptions}
                roles={scopeRoles}
                permissions={channelPermissions}
                loading={scopeLoading}
                description={
                  sheetScopeChoice === EVERYONE_VALUE
                    ? "Everyone on the server can see and use the channels in this folder."
                    : sheetScopeChoice === CUSTOM_VALUE
                      ? describeFolderRules(sheetScopeRules, roleNames)
                      : "Uses a template. Edit it in server settings and everything using it changes too."
                }
                onChoice={pickScope}
                onRules={drawRules}
              />
            </div>
          )}
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
