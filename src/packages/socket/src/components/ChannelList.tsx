import { Button, ContextMenu, Skeleton, Tooltip } from "@gryt/ui";
import type { StreamSources } from "@gryt/voice";
import { useMicrophone } from "@gryt/voice";
import { AnimatePresence, LayoutGroup, motion, Reorder } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getUploadsFileUrl,
  NotificationLevelMenu,
  type NotificationScope,
  resolveAvatarSrc,
} from "@/common";
import { Channel, SidebarItem, SidebarReorderEntry } from "@/settings/src/types/server";

import { PiCaretDownFill, PiCaretRightFill, PiChatCircleFill, PiChatsFill, PiGameControllerFill, PiGaugeFill, PiKeyboardFill, PiLockSimpleFill, PiRobotFill, PiSpeakerHighFill } from "../../../../lib/icons";
import type { DirectConversation } from "../hooks/useDirectMessages";
import type { Client } from "../types/clients";
import { ConnectedUser } from "./connectedUser";
import { DirectMessageList } from "./DirectMessageList";
import { EmojiText } from "./EmojiText";
import { LabelledDivider } from "./LabelledDivider";
import { MarkAsReadItem } from "./MarkAsReadItem";
import type { AdminActions,MemberInfo } from "./MemberSidebar";
import {
  buildReorderPayload,
  flattenSidebar,
  orderChanged,
  resolveDropParent,
} from "./sidebarTree";
import { UnreadIndicator } from "./UnreadIndicator";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

/** How far a row inside a folder is inset. Matches the caret's own width. */
const INDENT_PX = 14;

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
  streamSources,
  canManage,
  onEditItem,
  onDeleteItem,
  onMoveItem,
  onReorder,
  onAddItem,
  onDisconnectUser,
  currentUserRole,
  adminActions,
  unreadCounts,
  mentionCounts,
  directConversations,
  selectedDmId,
  onSelectDm,
  onHideDm,
  onManageGroup,
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
  streamSources?: StreamSources;
  canManage?: boolean;
  onEditItem?: (item: SidebarItem) => void;
  onDeleteItem?: (item: SidebarItem) => void;
  onMoveItem?: (item: SidebarItem, direction: "up" | "down") => void;
  /** A drag moves a channel into a folder as well as up the list, and the two
      arrive together, so an order alone cannot describe it. */
  onReorder?: (entries: SidebarReorderEntry[]) => void;
  onAddItem?: (kind: string) => void;
  onDisconnectUser?: (targetServerUserId: string) => void;
  currentUserRole?: Role;
  adminActions?: AdminActions;
  /** Unread messages per conversation id. Absent, or missing, means none. */
  unreadCounts?: Map<string, number>;
  /** Unseen mentions per conversation id. Absent means none. */
  mentionCounts?: Map<string, number>;
  directConversations?: DirectConversation[];
  selectedDmId?: string | null;
  onSelectDm?: (conversation: DirectConversation) => void;
  onHideDm?: (conversation: DirectConversation) => void;
  /** Open the settings for a group. Absent means no group management. */
  onManageGroup?: (conversation: DirectConversation) => void;
}) => {
  // The same analyser source the voice tile uses, so the row's ring and the
  // tile's agree. false takes no handle; useMicrophone is a singleton.
  const { microphoneBuffer } = useMicrophone(false);

  const memberByServerUserId = new Map(
    (members || []).map((m) => [m.serverUserId, m])
  );
  const avatarByServerUserId = new Map<string, string | null | undefined>(
    (members || []).map((m) => [m.serverUserId, m.avatarFileId])
  );
  const wornByServerUserId = new Map<string, string | null | undefined>(
    (members || []).map((m) => [m.serverUserId, m.avatarWorn])
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

  /* Local, because it is a view preference: an operator collapsing a folder
     should not fold it up for everybody. */
  const collapseKey = `gryt_sidebar_collapsed:${serverHost}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(collapseKey);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return new Set(Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : []);
    } catch {
      // Unreadable is the same as nothing collapsed, which shows more rather
      // than fewer channels.
      return new Set();
    }
  });

  const toggleCollapsed = useCallback((folderId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      try {
        localStorage.setItem(collapseKey, JSON.stringify([...next]));
      } catch {
        // Losing the preference costs a folder being open next time.
      }
      return next;
    });
  }, [collapseKey]);

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
    <LabelledDivider className="relative" lineClassName="opacity-70">
      {item.label ? <EmojiText text={item.label} /> : null}
    </LabelledDivider>
  );

  const renderSpacer = (item: SidebarItem) => {
    const h = Math.max(0, Math.min(500, Math.floor(item.spacerHeight ?? 16)));
    return (
      <div className="w-full relative" style={{ height: h }} />
    );
  };

  /** A header rather than a destination, so it never steals the selection. The
      count comes from the drawn rows, not the item list. */
  const renderFolder = (item: SidebarItem) => {
    const isCollapsed = collapsed.has(item.id);
    const Caret = isCollapsed ? PiCaretRightFill : PiCaretDownFill;
    const inside = folderRollup.get(item.id);

    /* Only while shut. Open, every child draws its own state, and a folder
       lit up above rows that are already lit is two answers to one question. */
    const holdsSelected = isCollapsed && !!inside?.holdsSelected;
    const unread = isCollapsed ? inside?.unread ?? 0 : 0;
    const mentions = isCollapsed ? inside?.mentions ?? 0 : 0;

    return (
      <div className="relative w-full">
        {/* Label, then a hairline running out to the caret on the right.
            No folder icon: a row that opens and shuts is already a folder, and
            the glyph cost 12px of indent on every label. With the caret moved
            over as well, the label sits at the row's own 8px padding instead of
            22px in, so nesting is the only thing left that shifts a row
            sideways.

            That puts it 8px left of where the channel icons start, not level
            with the channel names, which is deliberate — it reads as a heading
            over the rows rather than as another row. The rule carries the
            grouping: it runs from the label to the caret and gives the eye a
            line to follow down to the children.

            Nothing fills with accent any more. A shut folder holding the open
            channel tints its label and its rule instead. The fill was the
            loudest thing in the sidebar, louder than the channel you were
            actually in, which is the wrong way round. */}
        <button
          type="button"
          onClick={() => toggleCollapsed(item.id)}
          aria-expanded={!isCollapsed}
          className={[
            "flex w-full items-center gap-2 rounded-(--gryt-radius-md) px-2 py-1 text-left",
            "text-xs font-semibold tracking-wide transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gryt-accent-light",
            holdsSelected ? "text-gryt-accent"
              : unread > 0 || mentions > 0 ? "text-gryt-text"
              : "text-gryt-muted hover:text-gryt-text active:text-gryt-text",
          ].join(" ")}
        >
          <span className="min-w-0 shrink truncate">
            <EmojiText text={item.label || "Folder"} />
          </span>
          <span
            aria-hidden="true"
            className={[
              "h-px min-w-2 flex-1 transition-colors",
              holdsSelected ? "bg-gryt-accent/45" : "bg-gryt-border",
            ].join(" ")}
          />
          {isCollapsed && inside?.children ? (
            <span className="shrink-0 tabular-nums opacity-70">{inside.children}</span>
          ) : null}
          <UnreadIndicator unread={unread} mentions={mentions} />
          <Caret size={10} className="shrink-0" />
        </button>
      </div>
    );
  };

  const renderChannel = (item: SidebarItem) => {
    const channelId = item.channelId ?? item.id;
    const channel = channelById.get(channelId);
    const hasIndicators = channel?.type === "voice" && (channel?.eSportsMode || channel?.requirePushToTalk || channel?.disableRnnoise || channel?.maxBitrate);
    const unread =
      channel && channel.id !== selectedChannelId
        ? unreadCounts?.get(channel.id) ?? 0
        : 0;
    // Shown even for the open channel: a mention is cleared by reading rather
    // than by having it open, so one still counted has not been cleared.
    const mentions = channel ? mentionCounts?.get(channel.id) ?? 0 : 0;
    /* Visible and not enterable has always been expressible; the row never said
       so, and the refusal arrived from the media stack after the press. */
    const locked = channel?.type === "voice" && channel.canJoin === false;

    return (
      <div className="flex flex-col items-start w-full relative">
        {/* Ghost unless it is the one you are in. Every row was a plain
            <Button>, which is the filled accent one, so the whole list read as
            selected and the channel you were actually in was invisible —
            "you are here" was the one thing the list stopped saying. */}
        <Button size="small"
          tone={channel?.id === selectedChannelId ? "primary" : "ghost"}
          style={{
            width: "100%",
            justifyContent: "start",
            overflow: "hidden",
            // Dimmed rather than disabled: the row is still worth pressing,
            // because it says why.
            opacity: locked ? 0.55 : undefined,
          }}
          title={locked ? "You cannot join this voice channel." : undefined}
          onClick={() => {
            if (channel) onChannelClick(channel);
          }}
        >
          <div className="flex items-center" style={{ flexShrink: 0 }}>
            {/* The lock replaces the speaker rather than sitting beside it.
                Two glyphs on a row this narrow read as two things, and there
                is only one thing to say: this room is not for you. */}
            {locked
              ? <PiLockSimpleFill size={16} />
              : channel?.automated ? <PiRobotFill size={16} />
              : channel?.layout === "forum" ? <PiChatsFill size={16} />
              : channel?.type === "voice" ? <PiSpeakerHighFill size={16} /> : <PiChatCircleFill size={16} />}
          </div>
          {/* A ghost row's label is muted, so an unread channel looked exactly
              like a read one until you found the badge at the far end. */}
          <span
            className={`truncate${unread > 0 || mentions > 0 ? " font-semibold text-gryt-text" : ""}`}
            style={{ flex: 1, minWidth: 0, textAlign: "left", display: "block" }}
          >
            <EmojiText text={channel?.name || "(missing channel)"} />
          </span>
          {hasIndicators && (
            <div className="flex gap-1 items-center" style={{ marginLeft: "auto", flexShrink: 0 }}>
              {channel!.eSportsMode && (
                <Tooltip title="eSports mode">
                  <div className="flex items-center" style={{ color: "var(--gryt-neutral-9)" }}>
                    <PiGameControllerFill size={14} />
                  </div>
                </Tooltip>
              )}
              {channel!.requirePushToTalk && (
                <Tooltip title="Push to Talk required">
                  <div className="flex items-center" style={{ color: "var(--gryt-neutral-9)" }}>
                    <PiKeyboardFill size={14} />
                  </div>
                </Tooltip>
              )}
              {channel!.disableRnnoise && (
                <Tooltip title="Noise suppression disabled">
                  <span className="text-xs font-bold" style={{ color: "var(--gryt-neutral-9)", fontSize: 9, lineHeight: 1, padding: "1px 3px", border: "1px solid var(--gryt-neutral-7)", borderRadius: "var(--gryt-radius-sm)" }}>
                    RAW
                  </span>
                </Tooltip>
              )}
              {channel!.maxBitrate && (
                <Tooltip title={`Max bitrate: ${Math.round(channel!.maxBitrate! / 1000)} kbps`}>
                  <div className="flex items-center" style={{ color: "var(--gryt-neutral-9)" }}>
                    <PiGaugeFill size={14} />
                  </div>
                </Tooltip>
              )}
            </div>
          )}
          {channel?.type === "voice" &&
            isConnecting &&
            channel.id === currentChannelId &&
            serverHost === currentServerConnected && (
              <Skeleton
                variant="circular"
                width="16px"
                height="16px"
                style={{ marginLeft: hasIndicators ? "4px" : "auto" }}
              />
            )}
          {/* Last in the row, so it sits at the right edge and centres with
              the name. `marginLeft: auto` rather than a spacer, because the
              per-channel indicators above already claim `auto` when they are
              there and two of them would fight. */}
          <UnreadIndicator unread={unread} mentions={mentions} />
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
                <div className="flex w-full pt-2 flex-col" style={{
                    background: "var(--gryt-neutral-3)",
                    borderRadius: "0 0 var(--gryt-radius-lg) var(--gryt-radius-lg)",
                  }}>
                  {Object.keys(clients)?.map(
                    (id) =>
                      clients[id].voiceChannelId === channelId && (
                        <ConnectedUser
                          serverHost={serverHost}
                          isSpeaking={clientsSpeaking[id] || false}
                          avatarColor={
                            clients[id].serverUserId
                              ? memberByServerUserId.get(clients[id].serverUserId)?.avatarColor
                              : undefined
                          }
                          avatarWorn={
                            clients[id].serverUserId
                              ? wornByServerUserId.get(clients[id].serverUserId)
                              : undefined
                          }
                          speakingAnalyser={
                            id === currentConnectionId
                              ? microphoneBuffer.finalAnalyser
                              : clients[id].streamID
                                ? streamSources?.[clients[id].streamID]?.analyser
                                : undefined
                          }
                          isMuted={clients[id].isMuted}
                          isDeafened={clients[id].isDeafened}
                          isAFK={clients[id].isAFK}
                          nickname={clients[id].nickname}
                          avatarSrc={resolveAvatarSrc(
                            clients[id].serverUserId && avatarByServerUserId.get(clients[id].serverUserId)
                              ? getUploadsFileUrl(serverHost, avatarByServerUserId.get(clients[id].serverUserId) as string, { thumb: true })
                              : undefined,
                            clients[id].nickname,
                            clients[id].serverUserId ? wornByServerUserId.get(clients[id].serverUserId) : undefined,
                          )}
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
                          onToggleRole={adminActions?.onToggleRole && clients[id].serverUserId ? (role: Role, hold: boolean) => adminActions.onToggleRole!(clients[id].serverUserId!, role, hold) : undefined}
                          key={id}
                        />
                      )
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    );
  };

  /** A shut folder is the only row its children have, so it wears their state.
      Without the roll-up, collapsing one quietly mutes everything inside. */
  const folderRollup = useMemo(() => {
    const rollup = new Map<string, { children: number; unread: number; mentions: number; holdsSelected: boolean }>();
    for (const item of effectiveItems) {
      const parent = item.parentItemId;
      if (!parent) continue;
      const entry = rollup.get(parent) ?? { children: 0, unread: 0, mentions: 0, holdsSelected: false };
      entry.children += 1;

      const channelId = item.channelId ?? item.id;
      if (channelId === selectedChannelId) entry.holdsSelected = true;
      if (channelId !== selectedChannelId) entry.unread += unreadCounts?.get(channelId) ?? 0;
      entry.mentions += mentionCounts?.get(channelId) ?? 0;

      rollup.set(parent, entry);
    }
    return rollup;
  }, [effectiveItems, selectedChannelId, unreadCounts, mentionCounts]);

  const renderItem = (item: SidebarItem) => {
    if (item.kind === "separator") return renderSeparator(item);
    if (item.kind === "spacer") return renderSpacer(item);
    if (item.kind === "folder") return renderFolder(item);
    return renderChannel(item);
  };

  /** The menu lives in `common`: the server rail shows the same one, and the two
      copies had started to differ. */
  const notificationSubmenu = (scope: NotificationScope) => (
    <NotificationLevelMenu
      host={serverHost}
      scope={scope}
      placement={
        scope.kind === "channel"
          ? {
              channelId: scope.id,
              parentItemId:
                effectiveItems.find((i) => (i.channelId ?? i.id) === scope.id)
                  ?.parentItemId ?? null,
            }
          : null
      }
    />
  );

  const wrapWithContextMenu = (item: SidebarItem, index: number, content: React.ReactNode) => {
    /* A separator is decoration and carries nothing. A channel and a folder
       always do: how loud they are is that person's own setting. */
    const notifiable = item.kind === "channel" || item.kind === "folder";
    if (!canManage && !notifiable) return content;

    const isFirst = index === 0;
    const isLast = index === effectiveItems.length - 1;
    const label = item.kind === "channel"
      ? (channelById.get(item.channelId ?? item.id)?.name || "channel")
      : item.kind;

    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger>{content}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup>
          {/* The label names a group; without one Base UI throws, and a
              right-click on a channel took the app down. */}
          <ContextMenu.Group>
            <ContextMenu.GroupLabel>
              <EmojiText text={label} disableTooltip />
            </ContextMenu.GroupLabel>
          </ContextMenu.Group>

          {notifiable
            ? notificationSubmenu(
                item.kind === "folder"
                  ? { kind: "folder", id: item.id }
                  : { kind: "channel", id: item.channelId ?? item.id },
              )
            : null}

          {/* Under how loud it is, because they are the same kind of thing:
              this person's own view of the channel, not an admin action, and
              offered to everybody for that reason (GRYT-1030). A folder has
              nothing to read of its own, so it stands for its channels. */}
          {notifiable ? (
            <MarkAsReadItem
              host={serverHost}
              scope={
                item.kind === "folder"
                  ? {
                    kind: "folder",
                    channelIds: effectiveItems
                      .filter((i) => i.parentItemId === item.id && i.kind === "channel")
                      .map((i) => i.channelId ?? i.id),
                  }
                  : { kind: "conversation", id: item.channelId ?? item.id }
              }
            />
          ) : null}

          {canManage ? (
            <>
              {notifiable ? <ContextMenu.Separator /> : null}
              <ContextMenu.Item onClick={() => onEditItem?.(item)}>
                Edit
              </ContextMenu.Item>
              {/* Right-click anywhere in the list to start a folder. The new
                  one lands at the end, empty, and channels go in by being
                  dragged. */}
              <ContextMenu.Item onClick={() => onAddItem?.("folder")}>
                Add folder
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item disabled={isFirst} onClick={() => onMoveItem?.(item, "up")}>
                Move up
              </ContextMenu.Item>
              <ContextMenu.Item disabled={isLast} onClick={() => onMoveItem?.(item, "down")}>
                Move down
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item className="text-gryt-danger" onClick={() => onDeleteItem?.(item)}>
                Delete
              </ContextMenu.Item>
            </>
          ) : null}
        </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  };

  /** Drawn order: top level in position order, each folder followed by its own. */
  const rows = useMemo(
    () => flattenSidebar(effectiveItems, collapsed),
    [effectiveItems, collapsed],
  );

  const [localItems, setLocalItems] = useState(() => rows.map((r) => r.item));
  const isDragging = useRef(false);

  /** A ref, since it changes on every pointer move and only the indent preview
      reads it, through its own state. */
  const dragOffsetX = useRef(0);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pendingParent, setPendingParent] = useState<string | null>(null);

  useEffect(() => {
    if (!isDragging.current) {
      setLocalItems(rows.map((r) => r.item));
    }
  }, [rows]);

  const handleReorder = useCallback((newItems: SidebarItem[]) => {
    setLocalItems(newItems);
  }, []);

  const handleDrag = useCallback((item: SidebarItem, offsetX: number) => {
    dragOffsetX.current = offsetX;
    setPendingParent(resolveDropParent(localItems, item.id, offsetX, effectiveItems));
  }, [localItems, effectiveItems]);

  const handleDragEnd = useCallback((item: SidebarItem) => {
    isDragging.current = false;
    const parent = resolveDropParent(localItems, item.id, dragOffsetX.current, effectiveItems);
    dragOffsetX.current = 0;
    setDraggingId(null);
    setPendingParent(null);

    if (!orderChanged(rows, localItems.map((i) => i.id), item.id, parent)) return;
    onReorder?.(buildReorderPayload(localItems, effectiveItems, item.id, parent));
  }, [localItems, effectiveItems, rows, onReorder]);

  const depthById = useMemo(() => {
    const map = new Map<string, 0 | 1>();
    for (const row of rows) map.set(row.item.id, row.depth);
    return map;
  }, [rows]);

  /** A channel held right of the threshold is drawn indented before the drop, so
      the folder it is about to join is visible rather than guessed. */
  const indentFor = (item: SidebarItem): number => {
    if (draggingId === item.id) return pendingParent ? 1 : 0;
    return depthById.get(item.id) ?? 0;
  };

  const displayItems = canManage ? localItems : rows.map((r) => r.item);

  /** Outside the reorder group: these are not sidebar items an operator
      arranges, and a channel does not belong among them. */
  const directMessages = onSelectDm ? (
    <>
      <DirectMessageList
        title="Direct messages"
        conversations={(directConversations ?? []).filter((c) => c.kind !== "group")}
        serverHost={serverHost}
        selectedConversationId={selectedDmId ?? null}
        unreadCounts={unreadCounts}
        mentionCounts={mentionCounts}
        onSelect={onSelectDm}
        onHide={onHideDm}
      />
      <DirectMessageList
        title="Groups"
        onManage={onManageGroup}
        conversations={(directConversations ?? []).filter((c) => c.kind === "group")}
        serverHost={serverHost}
        selectedConversationId={selectedDmId ?? null}
        unreadCounts={unreadCounts}
        mentionCounts={mentionCounts}
        onSelect={onSelectDm}
        onHide={onHideDm}
      />
    </>
  ) : null;

  const staticList = (
    <LayoutGroup id={serverHost}>
      <div className="flex flex-col gap-3 items-center w-full">
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
              style={{ width: "100%", paddingLeft: indentFor(item) * INDENT_PX }}
            >
              {wrapWithContextMenu(item, index, renderItem(item))}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );

  /* Still a right-click without `manage_channels`, because how loud a server is
     belongs to them. Only the notification choice. */
  if (!canManage) {
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={
            <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }} />
          }
        >
          {staticList}
          {directMessages}
          <div style={{ flex: 1 }} />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup>
              <ContextMenu.Group>
                <ContextMenu.GroupLabel>
                  This server
                </ContextMenu.GroupLabel>
              </ContextMenu.Group>
              {notificationSubmenu({ kind: "server" })}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  }

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
            style={{ width: "100%", cursor: "grab", paddingLeft: indentFor(item) * INDENT_PX }}
            whileDrag={{
              scale: 1.02,
              boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
              cursor: "grabbing",
              zIndex: 50,
              borderRadius: "var(--gryt-radius-md)",
            }}
            onDragStart={() => { isDragging.current = true; setDraggingId(item.id); }}
            /* `axis="y"` pins the row and not the pointer, so `info.offset.x`
               still reports the depth half of the gesture. */
            onDrag={(_event, info) => handleDrag(item, info.offset.x)}
            onDragEnd={() => handleDragEnd(item)}
          >
            {wrapWithContextMenu(item, index, renderItem(item))}
          </Reorder.Item>
        ))}
      </AnimatePresence>
    </Reorder.Group>
  );

  return (
    <ContextMenu.Root>
      {/* `render`, so the trigger *is* the full-height column rather than an
          unstyled wrapper around one. Base UI's ContextMenu.Trigger draws a
          plain div with no styles of its own, which broke the height chain: the
          sidebar's scroller is a flex column, the trigger sat between it and
          the sized child, and `min-height: 100%` on that child resolved against
          the trigger's auto height rather than the scroller's. Measured in a
          400px scroller holding 80px of channels, every element came out 80px
          — so a right-click below the last channel landed on the scroller and
          nothing opened, while aiming at the gap between two channels worked.
          That is why this read as fussy rather than broken. */}
      <ContextMenu.Trigger
        render={
          <div style={{ display: "flex", flexDirection: "column", minHeight: "100%" }} />
        }
      >
        {draggableList}
        {directMessages}
        {/* Takes the leftover space, so the empty area below the last channel
            belongs to the trigger. The column is otherwise only as tall as its
            content even when the trigger is not. */}
        <div style={{ flex: 1 }} />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
        <ContextMenu.Group>
          <ContextMenu.GroupLabel>
            This server
          </ContextMenu.GroupLabel>
        </ContextMenu.Group>
        {notificationSubmenu({ kind: "server" })}
        <ContextMenu.Separator />
        <ContextMenu.Item onClick={() => onAddItem?.("channel:text")}>
          Add channel
        </ContextMenu.Item>
        <ContextMenu.Item onClick={() => onAddItem?.("folder")}>
          Add folder
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onClick={() => onAddItem?.("separator")}>
          Add separator
        </ContextMenu.Item>
        <ContextMenu.Item onClick={() => onAddItem?.("spacer")}>
          Add spacer
        </ContextMenu.Item>
      </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};
