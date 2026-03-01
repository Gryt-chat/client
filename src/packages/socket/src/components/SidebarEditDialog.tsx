import { Dialog, Flex, IconButton, Select, Switch, Text, TextField } from "@radix-ui/themes";
import { useCallback, useRef } from "react";
import { MdClose } from "react-icons/md";

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
      <Dialog.Content maxWidth="480px">
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Dialog.Title as="h2" size="5" weight="bold" style={{ margin: 0 }}>
              {selectedSidebarItem?.kind === "channel" ? "Channel settings"
                : selectedSidebarItem?.kind === "separator" ? "Separator settings"
                : "Spacer settings"}
            </Dialog.Title>
            <Dialog.Close>
              <IconButton variant="soft" color="gray"><MdClose size={16} /></IconButton>
            </Dialog.Close>
          </Flex>

          {selectedSidebarItem?.kind === "channel" && (
            <>
              <Flex direction="column" gap="2">
                <Text size="2" weight="medium">Name</Text>
                <TextField.Root
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
                      <Text size="1" color="gray">Lowest latency: PTT, no RNNoise, 128 kbps bitrate, 10ms Opus</Text>
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
                      <Text size="1" color="gray">Users must hold a key to transmit</Text>
                    </Flex>
                    <Switch checked={sheetRequirePtt} onCheckedChange={(v) => { setSheetRequirePtt(v); debouncedSave(); }} />
                  </Flex>
                  <Flex align="center" justify="between">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">Disable Noise Reduction</Text>
                      <Text size="1" color="gray">Raw audio with no processing for lower latency</Text>
                    </Flex>
                    <Switch checked={sheetDisableRnnoise} disabled={sheetEsportsMode} onCheckedChange={(v) => { setSheetDisableRnnoise(v); debouncedSave(); }} />
                  </Flex>
                  <Flex direction="column" gap="2">
                    <Text size="2" weight="medium">Max Bitrate</Text>
                    <Select.Root
                      value={sheetMaxBitrate || "default"}
                      onValueChange={(v) => { setSheetMaxBitrate(v === "default" ? "" : v); debouncedSave(); }}
                    >
                      <Select.Trigger />
                      <Select.Content position="popper" sideOffset={4}>
                        <Select.Item value="default">Default</Select.Item>
                        <Select.Separator />
                        <Select.Item value="32000">32 kbps</Select.Item>
                        <Select.Item value="64000">64 kbps</Select.Item>
                        <Select.Item value="96000">96 kbps</Select.Item>
                        <Select.Item value="128000">128 kbps</Select.Item>
                        <Select.Item value="256000">256 kbps</Select.Item>
                        <Select.Item value="510000">510 kbps</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </Flex>
                  <Flex align="center" justify="between">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="medium">Enable Text Chat</Text>
                      <Text size="1" color="gray">Allow text messages in this voice channel</Text>
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
              <TextField.Root
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
              <TextField.Root
                value={sheetSeparatorLabel}
                onChange={(e) => setSheetSeparatorLabel(e.target.value)}
                onBlur={flushSave}
                onKeyDown={handleKeyEnter}
                placeholder="Optional"
              />
            </Flex>
          )}
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};
