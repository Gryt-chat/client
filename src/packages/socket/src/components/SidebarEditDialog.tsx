import { Dialog, IconButton, Select, Switch, TextField } from "@gryt/ui";
import { Flex, Text } from "@radix-ui/themes";
import { useCallback, useRef } from "react";
import { PiX } from "react-icons/pi";

import type { SidebarItem } from "@/settings/src/types/server";

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

  const handleClose = () => { flushSave(); closeEditDialog(); };
  const handleKeyEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") handleClose(); };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="max-w-120">
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Dialog.Title style={{ margin: 0 }}>
              {selectedSidebarItem?.kind === "channel" ? "Channel settings"
                : selectedSidebarItem?.kind === "separator" ? "Separator settings"
                : "Spacer settings"}
            </Dialog.Title>
            <Dialog.Close>
              <IconButton size="xsmall"><PiX size={16} /></IconButton>
            </Dialog.Close>
          </Flex>

          {selectedSidebarItem?.kind === "channel" && (
            <>
              <Flex direction="column" gap="2">
                <Text size="2" weight="medium">Name</Text>
                <TextField
                  value={sheetChannelName}
                  onChange={(e) => setSheetChannelName(e.target.value)}
                  onBlur={flushSave}
                  onKeyDown={handleKeyEnter}
                  placeholder="Channel name"
                />
              </Flex>
              <Flex align="center" justify="between">
                <Text size="2" weight="medium">Voice channel</Text>
                <Switch checked={sheetChannelIsVoice} onCheckedChange={(v) => { setSheetChannelIsVoice(v); debouncedSave(); }} />
              </Flex>
              {sheetChannelIsVoice && (
                <>
                  <Flex align="center" justify="between">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">eSports Mode</Text>
                      <Text size="1">Lowest latency: PTT, no RNNoise, 128 kbps bitrate, 10ms Opus</Text>
                    </Flex>
                    <Switch checked={sheetEsportsMode} onCheckedChange={(v) => {
                      setSheetEsportsMode(v);
                      if (v) { setSheetRequirePtt(true); setSheetDisableRnnoise(true); }
                      debouncedSave();
                    }} />
                  </Flex>
                  <Flex align="center" justify="between">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">Require Push to Talk</Text>
                      <Text size="1">Users must hold a key to transmit</Text>
                    </Flex>
                    <Switch checked={sheetRequirePtt} onCheckedChange={(v) => { setSheetRequirePtt(v); debouncedSave(); }} />
                  </Flex>
                  <Flex align="center" justify="between">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">Disable Noise Reduction</Text>
                      <Text size="1">Raw audio with no processing for lower latency</Text>
                    </Flex>
                    <Switch checked={sheetDisableRnnoise} disabled={sheetEsportsMode} onCheckedChange={(v) => { setSheetDisableRnnoise(v); debouncedSave(); }} />
                  </Flex>
                  <Flex direction="column" gap="2">
                    <Text size="2" weight="medium">Max Bitrate</Text>
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
                  </Flex>
                  <Flex align="center" justify="between">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">Enable Text Chat</Text>
                      <Text size="1">Allow text messages in this voice channel</Text>
                    </Flex>
                    <Switch checked={sheetTextInVoice} onCheckedChange={(v) => { setSheetTextInVoice(v); debouncedSave(); }} />
                  </Flex>
                </>
              )}
            </>
          )}

          {selectedSidebarItem?.kind === "spacer" && (
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">Height</Text>
              <TextField
                value={sheetSpacerHeight}
                onChange={(e) => setSheetSpacerHeight(e.target.value)}
                onBlur={flushSave}
                onKeyDown={handleKeyEnter}
                placeholder="16"
              />
            </Flex>
          )}

          {selectedSidebarItem?.kind === "separator" && (
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">Label</Text>
              <TextField
                value={sheetSeparatorLabel}
                onChange={(e) => setSheetSeparatorLabel(e.target.value)}
                onBlur={flushSave}
                onKeyDown={handleKeyEnter}
                placeholder="Optional"
              />
            </Flex>
          )}
        </Flex>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
