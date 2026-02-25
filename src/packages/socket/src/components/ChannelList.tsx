import { Box, Button, ContextMenu, Flex, Text, Tooltip } from "@radix-ui/themes";
import { AnimatePresence, LayoutGroup, motion, Reorder } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdChat, MdKeyboard, MdRadio, MdSportsEsports, MdVolumeUp } from "react-icons/md";

import { getUploadsFileUrl } from "@/common";
import { Channel, SidebarItem } from "@/settings/src/types/server";

import type { Client } from "../types/clients";
import { ConnectedUser } from "./connectedUser";
import { EmojiText } from "./EmojiText";
import type { AdminActions,MemberInfo } from "./MemberSidebar";
import { SkeletonBase } from "./skeletons";

type Role = "owner" | "admin" | "mod" | "member";

export const ChannelList = ({
  channels,
  items,
  serverHost,
  clients,
  members,
  currentChannelId,
  currentServerConnected,
  isConnecting,
  currentConnectionId,
  selectedChannelId,
  onChannelClick,
  clientsSpeaking,
  canManage,
  onEditItem,
  onDeleteItem,
  onMoveItem,
  onReorder,
  onAddItem,
  onDisconnectUser,
  currentUserRole,
  adminActions,
}: {
  channels: Channel[];
  items?: SidebarItem[];
  serverHost: string;
  clients: Record<string, Client>;
  members?: MemberInfo[];
  currentChannelId: string;
  currentServerConnected: string | null;
  showVoiceView: boolean;
  isConnecting: boolean;
  currentConnectionId?: string;
  selectedChannelId: string | null;
  onChannelClick: (channel: Channel) => void;
  clientsSpeaking: Record<string, boolean>;
  canManage?: boolean;
  onEditItem?: (item: SidebarItem) => void;
  onDeleteItem?: (item: SidebarItem) => void;
  onMoveItem?: (item: SidebarItem, direction: "up" | "down") => void;
  onReorder?: (ids: string[]) => void;
  onAddItem?: (kind: string) => void;
  onDisconnectUser?: (targetServerUserId: string) => void;
  currentUserRole?: Role;
  adminActions?: AdminActions;
}) => {
  const memberByServerUserId = new Map(
    (members || []).map((m) => [m.serverUserId, m])
  );
  const avatarByServerUserId = new Map<string, string | null | undefined>(
    (members || []).map((m) => [m.serverUserId, m.avatarFileId])
  );
  const effectiveItems: SidebarItem[] =
    items && items.length > 0
      ? items
      : channels.map((c, idx) => ({
          id: c.id,
          kind: "channel",
          channelId: c.id,
          position: (idx + 1) * 10,
        }));

  const channelById = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels],
  );

  const stableKeyById = useMemo(() => {
    const keys = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const item of effectiveItems) {
      let base: string;
      switch (item.kind) {
        case "channel": {
          const ch = channelById.get(item.channelId ?? item.id);
          base = ch ? `${serverHost}:${ch.type}:${ch.name}` : `${serverHost}:ch:${item.id}`;
          break;
        }
        case "separator":
          base = `${serverHost}:sep:${item.label ?? ""}`;
          break;
        case "spacer":
          base = `${serverHost}:spc:${item.spacerHeight ?? 16}`;
          break;
        default:
          base = `${serverHost}:${item.id}`;
      }
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      keys.set(item.id, count > 0 ? `${base}#${count}` : base);
    }
    return keys;
  }, [effectiveItems, channelById, serverHost]);

  const renderSeparator = (item: SidebarItem) => (
    <Flex width="100%" position="relative" align="center" gap="2">
      <Box style={{ height: 1, background: "var(--gray-6)", flex: 1, opacity: 0.7 }} />
      {item.label ? (
        <Text size="1" color="gray">
          <EmojiText text={item.label} />
        </Text>
      ) : null}
      <Box style={{ height: 1, background: "var(--gray-6)", flex: 1, opacity: 0.7 }} />
    </Flex>
  );

  const renderSpacer = (item: SidebarItem) => {
    const h = Math.max(0, Math.min(500, Math.floor(item.spacerHeight ?? 16)));
    return (
      <Box
        width="100%"
        position="relative"
        style={{ height: h }}
      />
    );
  };

  const renderChannel = (item: SidebarItem) => {
    const channelId = item.channelId ?? item.id;
    const channel = channelById.get(channelId);
    const hasIndicators = channel?.type === "voice" && (channel?.eSportsMode || channel?.requirePushToTalk || channel?.disableRnnoise || channel?.maxBitrate);

    return (
      <Flex direction="column" align="start" width="100%" position="relative">
        <Button
          variant={channel?.id === selectedChannelId ? "solid" : "soft"}
          radius="large"
          style={{
            width: "100%",
            justifyContent: "start",
            overflow: "hidden",
          }}
          onClick={() => {
            if (channel) onChannelClick(channel);
          }}
        >
          <Flex align="center" style={{ flexShrink: 0 }}>
            {channel?.type === "voice" ? <MdVolumeUp size={16} /> : <MdChat size={16} />}
          </Flex>
          <Text truncate style={{ flex: 1, minWidth: 0, textAlign: "left", display: "block" }}>
            <EmojiText text={channel?.name || "(missing channel)"} />
          </Text>
          {hasIndicators && (
            <Flex gap="1" align="center" style={{ marginLeft: "auto", flexShrink: 0 }}>
              {channel!.eSportsMode && (
                <Tooltip content="eSports mode">
                  <Flex align="center" style={{ color: "var(--gray-9)" }}>
                    <MdSportsEsports size={14} />
                  </Flex>
                </Tooltip>
              )}
              {channel!.requirePushToTalk && (
                <Tooltip content="Push to Talk required">
                  <Flex align="center" style={{ color: "var(--gray-9)" }}>
                    <MdKeyboard size={14} />
                  </Flex>
                </Tooltip>
              )}
              {channel!.disableRnnoise && (
                <Tooltip content="Noise suppression disabled">
                  <Text size="1" weight="bold" style={{ color: "var(--gray-9)", fontSize: 9, lineHeight: 1, padding: "1px 3px", border: "1px solid var(--gray-7)", borderRadius: "var(--radius-1)" }}>
                    RAW
                  </Text>
                </Tooltip>
              )}
              {channel!.maxBitrate && (
                <Tooltip content={`Max bitrate: ${Math.round(channel!.maxBitrate! / 1000)} kbps`}>
                  <Flex align="center" style={{ color: "var(--gray-9)" }}>
                    <MdRadio size={14} />
                  </Flex>
                </Tooltip>
              )}
            </Flex>
          )}
          {channel?.type === "voice" &&
            isConnecting &&
            channel.id === currentChannelId &&
            serverHost === currentServerConnected && (
              <SkeletonBase
                width="16px"
                height="16px"
                borderRadius="50%"
                style={{ marginLeft: hasIndicators ? "4px" : "auto" }}
              />
            )}
        </Button>

        {channel?.type === "voice" && (
          <AnimatePresence initial={false}>
            {Object.values(clients).some((c) => c.voiceChannelId === channelId) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ overflow: "hidden", width: "100%" }}
              >
                <Flex
                  width="100%"
                  pt="2"
                  direction="column"
                  style={{
                    background: "var(--gray-3)",
                    borderRadius: "0 0 var(--radius-5) var(--radius-5)",
                  }}
                >
                  {Object.keys(clients)?.map(
                    (id) =>
                      clients[id].voiceChannelId === channelId && (
                        <ConnectedUser
                          isSpeaking={clientsSpeaking[id] || false}
                          isMuted={clients[id].isMuted}
                          isDeafened={clients[id].isDeafened}
                          isAFK={clients[id].isAFK}
                          nickname={clients[id].nickname}
                          avatarSrc={
                            clients[id].serverUserId && avatarByServerUserId.get(clients[id].serverUserId)
                              ? getUploadsFileUrl(serverHost, avatarByServerUserId.get(clients[id].serverUserId) as string)
                              : undefined
                          }
                          serverUserId={clients[id].serverUserId}
                          isSelf={id === currentConnectionId}
                          isConnectedToVoice={clients[id].isConnectedToVoice ?? true}
                          isConnectingToVoice={
                            (id === currentConnectionId &&
                              isConnecting &&
                              serverHost === currentServerConnected &&
                              channel.id === currentChannelId) ||
                            (id !== currentConnectionId && !clients[id].isConnectedToVoice)
                          }
                          screenShareEnabled={clients[id].screenShareEnabled}
                          cameraEnabled={clients[id].cameraEnabled}
                          canDisconnect={!!onDisconnectUser}
                          onDisconnectFromVoice={onDisconnectUser && clients[id].serverUserId ? () => onDisconnectUser(clients[id].serverUserId!) : undefined}
                          role={currentUserRole}
                          targetRole={clients[id].serverUserId ? memberByServerUserId.get(clients[id].serverUserId!)?.role : undefined}
                          isServerMuted={clients[id].serverUserId ? memberByServerUserId.get(clients[id].serverUserId!)?.isServerMuted : undefined}
                          isServerDeafened={clients[id].serverUserId ? memberByServerUserId.get(clients[id].serverUserId!)?.isServerDeafened : undefined}
                          onKick={adminActions?.onKickUser && clients[id].serverUserId ? () => adminActions.onKickUser!(clients[id].serverUserId!) : undefined}
                          onBan={adminActions?.onBanUser && clients[id].serverUserId ? () => adminActions.onBanUser!(clients[id].serverUserId!) : undefined}
                          onServerMute={adminActions?.onServerMuteUser && clients[id].serverUserId ? (muted: boolean) => adminActions.onServerMuteUser!(clients[id].serverUserId!, muted) : undefined}
                          onServerDeafen={adminActions?.onServerDeafenUser && clients[id].serverUserId ? (deafened: boolean) => adminActions.onServerDeafenUser!(clients[id].serverUserId!, deafened) : undefined}
                          onChangeRole={adminActions?.onChangeRole && clients[id].serverUserId ? (role: Role) => adminActions.onChangeRole!(clients[id].serverUserId!, role) : undefined}
                          key={id}
                        />
                      )
                  )}
                </Flex>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </Flex>
    );
  };

  const renderItem = (item: SidebarItem) => {
    if (item.kind === "separator") return renderSeparator(item);
    if (item.kind === "spacer") return renderSpacer(item);
    return renderChannel(item);
  };

  const wrapWithContextMenu = (item: SidebarItem, index: number, content: React.ReactNode) => {
    if (!canManage) return content;
    const isFirst = index === 0;
    const isLast = index === effectiveItems.length - 1;
    const label = item.kind === "channel"
      ? (channelById.get(item.channelId ?? item.id)?.name || "channel")
      : item.kind;

    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger>{content}</ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Label style={{ fontWeight: "bold" }}>
            <EmojiText text={label} />
          </ContextMenu.Label>
          <ContextMenu.Item onClick={() => onEditItem?.(item)}>
            Edit
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item disabled={isFirst} onClick={() => onMoveItem?.(item, "up")}>
            Move up
          </ContextMenu.Item>
          <ContextMenu.Item disabled={isLast} onClick={() => onMoveItem?.(item, "down")}>
            Move down
          </ContextMenu.Item>
          <ContextMenu.Separator />
          <ContextMenu.Item color="red" onClick={() => onDeleteItem?.(item)}>
            Delete
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    );
  };

  const [localItems, setLocalItems] = useState(effectiveItems);
  const isDragging = useRef(false);

  useEffect(() => {
    if (!isDragging.current) {
      setLocalItems(effectiveItems);
    }
  }, [effectiveItems]);

  const handleReorder = useCallback((newItems: SidebarItem[]) => {
    setLocalItems(newItems);
  }, []);

  const handleDragEnd = useCallback(() => {
    isDragging.current = false;
    const ids = localItems.map((i) => i.id);
    const originalIds = effectiveItems.map((i) => i.id);
    if (ids.join(",") !== originalIds.join(",")) {
      onReorder?.(ids);
    }
  }, [localItems, effectiveItems, onReorder]);

  const displayItems = canManage ? localItems : effectiveItems;

  const staticList = (
    <LayoutGroup id={serverHost}>
      <Flex direction="column" gap="3" align="center" width="100%">
        <AnimatePresence initial={false} mode="popLayout">
          {displayItems.map((item, index) => (
            <motion.div
              key={stableKeyById.get(item.id) ?? item.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{
                layout: { type: "spring", stiffness: 350, damping: 30 },
                opacity: { duration: 0.2 },
                y: { duration: 0.2 },
              }}
              style={{ width: "100%" }}
            >
              {wrapWithContextMenu(item, index, renderItem(item))}
            </motion.div>
          ))}
        </AnimatePresence>
      </Flex>
    </LayoutGroup>
  );

  if (!canManage) return staticList;

  const draggableList = (
    <Reorder.Group
      axis="y"
      values={localItems}
      onReorder={handleReorder}
      as="div"
      style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", width: "100%" }}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {localItems.map((item, index) => (
          <Reorder.Item
            key={stableKeyById.get(item.id) ?? item.id}
            value={item}
            as="div"
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{
              layout: { type: "spring", stiffness: 350, damping: 30 },
              opacity: { duration: 0.2 },
              y: { duration: 0.2 },
            }}
            style={{ width: "100%", cursor: "grab" }}
            whileDrag={{
              scale: 1.02,
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              cursor: "grabbing",
              zIndex: 50,
              borderRadius: "var(--radius-4)",
            }}
            onDragStart={() => { isDragging.current = true; }}
            onDragEnd={handleDragEnd}
          >
            {wrapWithContextMenu(item, index, renderItem(item))}
          </Reorder.Item>
        ))}
      </AnimatePresence>
    </Reorder.Group>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: "100%" }}>
          {draggableList}
          <div style={{ flex: 1 }} />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item onClick={() => onAddItem?.("channel:text")}>
          Add channel
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onClick={() => onAddItem?.("separator")}>
          Add separator
        </ContextMenu.Item>
        <ContextMenu.Item onClick={() => onAddItem?.("spacer")}>
          Add spacer
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
};
