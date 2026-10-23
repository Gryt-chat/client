import { Avatar, Button, IconButton, Menu, Tooltip } from "@gryt/ui";
import { useCamera, useSFU } from "@gryt/voice";
import { motion } from "motion/react";
import { type ReactNode,useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { clearMentions, clearSignedOut, getUploadsFileUrl, markChannelRead, NotificationLevelMenu, resolveAvatarSrc, serverIconSrc, useAccount, useMentionTracker, useThreadMentions, useThreadUnread, useUnreadTracker } from "@/common";
import { NOTIFICATION_CHANNEL_OPEN_EVENT } from "@/lib/desktopNotification";
import { useIsCompact, useIsMobile } from "@/mobile";
import { useSettings } from "@/settings";
import { useEmbeddedServer } from "@/settings/src/hooks/useEmbeddedServer";
import { hostedServerAt, manageServerTab } from "@/settings/src/hostedServers";
import type { SidebarItem } from "@/settings/src/types/server";
import { setInACall } from "@/webRTC";

import { PiCameraFill,PiCaretLeftBold, PiGearSixFill, PiMagnifyingGlassBold, PiPhoneFill, PiShieldCheckFill, PiSidebarSimpleFill } from "../../../../lib/icons";
import { useFakeChat } from "../dev/fakeChat";
import { useFakeChatRunning } from "../dev/fakeChatController";
import { fakeConversations, fakeDmsOn, fakeHostNow } from "../dev/fakeDms";
import {
  fakeChatSendersFrom,
  fakeParticipantOptionsFromSettings,
  readFakeParticipantOptions,
  withFakeMembers,
  withFakeParticipants,
} from "../dev/fakeParticipants";
import { readFakeCallOptions, useFakeCallEvents } from "../dev/fakeServerEvents";
import { useFakeSpeech } from "../dev/fakeSpeech";
import { takeCallRequest } from "../hooks/callRequest";
import { useDirectory } from "../hooks/dmDirectory";
import { conversationFor, conversationOpened, leftOver, rememberConversation, requestConversation, setDmSpaceOpen, usePendingConversation, useVisitingConversation, visitConversation } from "../hooks/dmSpace";
import { hideConversation } from "../hooks/hiddenConversations";
import { useOpenThread } from "../hooks/openThreadMemory";
import { useAdminActions } from "../hooks/useAdminActions";
import { useBlocks } from "../hooks/useBlocks";
import { callClock, useCallClock } from "../hooks/useCallClock";
import { useCalls } from "../hooks/useCalls";
import { useChannelSettings, useHandleChannelClick } from "../hooks/useChannelSettings";
import { useChat } from "../hooks/useChat";
import { conversationTitle, type DirectConversation,useDirectMessages } from "../hooks/useDirectMessages";
import { useLatencyReporting } from "../hooks/useLatencyReporting";
import { useIsTinyWindow, useRoomForMemberList, useRoomForThreadBeside, useRoomForVoicePanel } from "../hooks/useNarrowWindow";
import { usePeerLatency } from "../hooks/usePeerLatency";
import { useServerPermissions } from "../hooks/usePermissions";
import { usePins } from "../hooks/usePins";
import { useReportUser } from "../hooks/useReportUser";
import { useServerManagement } from "../hooks/useServerManagement";
import { useServerReports } from "../hooks/useServerReports";
import { useServerState } from "../hooks/useServerState";
import { SIDEBAR_HOVER_PX, SIDEBAR_WIDTH_PX, useMediaAutoShow, useSidebarHover, useVoiceLayout } from "../hooks/useServerViewLayout";
import { useSidebarEditor } from "../hooks/useSidebarEditor";
import { useSockets } from "../hooks/useSockets";
import { getUpdateAvailable } from "../hooks/useVersionStatus";
import { takeVoiceJoin, usePendingVoiceJoin } from "../hooks/voiceJoinRequest";
import { THREAD_PANEL_WIDTH } from "../lib/narrowLayout";
import { getCustomEmojis } from "../utils/emojiData";
import type { SearchFilter } from "../utils/messageSearch";
import { setOnScreenConversation } from "../utils/onScreenConversation";
import { ChannelDescription } from "./ChannelDescription";
import { ChatView } from "./ChatView";
import { ConfirmDialog } from "./ConfirmDialog";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { DmGroupPanel, DmPersonPanel, PANEL_WIDTH as DM_PANEL_WIDTH } from "./DmInfoPanel";
import { DmSpaceSidebar } from "./DmSpaceSidebar";
import { FriendButton } from "./FriendButton";
import { GroupDialog } from "./GroupDialog";
import { GroupFace } from "./GroupFace";
import { hideConversationWithUndo, useConfirmHide } from "./hideConversation";
import { IncomingCallCard } from "./IncomingCallCard";
import { type MemberCardActions, MemberCardActionsContext } from "./memberCard/memberCardContext";
import { MemberSidebarPanel } from "./MemberSidebarPanel";
import { statusConfig } from "./memberStatus";
import { MessagesHome } from "./MessagesHome";
import { MobileServerView } from "./MobileServerView";
import { NewFolderDialog } from "./NewFolderDialog";
import { NotEncryptedPopover } from "./NotEncryptedPopover";
import { PresenceDot } from "./PresenceDot";
import { ReportUserDialog } from "./ReportUserDialog";
import { SearchPanel } from "./SearchPanel";
import { SecurityNoticeBanner } from "./SecurityNoticeBanner";
import { ServerChip } from "./ServerChip";
import { ServerConfirmDialogs } from "./ServerConfirmDialogs";
import { ServerLoadingStates } from "./ServerLoadingStates";
import { ServerNoticePanel } from "./ServerNoticePanel";
import { ServerSidebar } from "./ServerSidebar";
import { SidebarEditDialog } from "./SidebarEditDialog";
import { type ChannelPlacement, folderOf } from "./sidebarTree";
import { UnreachableServer } from "./UnreachableServer";
import { VoiceSheetButton } from "./VoiceSheetButton";
import { VoiceView } from "./VoiceView";

// Parsed once at module load. The query string overrides the Developer panel
// while it is present, which keeps the browser workflow working.
const fakeParticipantOptionsFromUrl = readFakeParticipantOptions(
  window.location.search,
);

/** `?fakering=1` rings the open conversation, `?fakepeer=1` puts somebody in the
    call, and `&fakecallmembers=0` reproduces a call that drew nobody. */
const fakeCallOptionsFromUrl = readFakeCallOptions(window.location.search);

/** The messages list is wider than the channel list: two lines a row, with previews. */
const DM_LIST_WIDTH_PX = 320;

function connectionLine(status: string | undefined, unreachable: boolean, name: string) {
  if (status === "reconnecting") return { long: `Reconnecting to ${name}…`, short: "Reconnecting…" };
  return unreachable ? { long: `Can’t reach ${name}`, short: "Can’t reach it" } : null;
}

function voiceWidthFor(s: { chatTakenOver: boolean; voiceWidth: string; isMaximized: boolean; shownVoiceWidth: number }): string {
  if (s.chatTakenOver) return "100%";
  if (s.voiceWidth === "0px") return "0px";
  return s.isMaximized ? "100%" : `${s.shownVoiceWidth}px`;
}

function sidePanelOf(s: { searchOpen: boolean; dmSpace: boolean | undefined; dmSearchOpen: boolean; activeDm: boolean; isTiny: boolean }) {
  if (s.searchOpen && !s.dmSpace) return "search";
  if (s.dmSpace && s.dmSearchOpen) return "dm-search";
  if (s.dmSpace && s.activeDm && !s.isTiny) return "dm-member";
  return "members";
}

function callerTitle(conversation: Parameters<typeof conversationTitle>[0] | undefined, fallback: string): string {
  return conversation ? conversationTitle(conversation) : fallback;
}

/**
 * `dmSpace` swaps the channel sidebar for every server's conversations and drops
 * the member panel. The rest is the same view, keys and all (GRYT-1134).
 */
export const ServerView = ({ dmSpace = false }: { dmSpace?: boolean }) => {
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const isTiny = useIsTinyWindow();
  const {
    showVoiceView, setShowVoiceView, nickname, setShowSettings, setSettingsTab, openSettings,
    inputMode, setInputMode, rnnoiseEnabled, setRnnoiseEnabled,
    eSportsModeEnabled, setESportsModeEnabled, noiseGate, setNoiseGate,
    pinChannelsSidebar, setPinChannelsSidebar,
    pinMembersSidebar, setPinMembersSidebar,
    setIsMuted, setIsDeafened,
    devFakeParticipants, devFakeMuted, devFakeScreenShare,
    devFakeDeafened, devFakeSpeaking, devFakeMembers, devFakeChatSeconds,
  } = useSettings();
  const { currentlyViewingServer, setShowRemoveServer, setLastSelectedChannelForServer, viewServerBehindDmSpace } = useServerManagement();
  const directory = useDirectory();
  /* The conversations as the search panel's "channels", which is what it names a hit by
     and what `in:` offers. Only the fields it reads. */
  const dmSearchChannels = useMemo(
    () => directory.map((e) => ({ id: e.conversation.conversation_id, name: conversationTitle(e.conversation), type: "text" }) as Parameters<typeof SearchPanel>[0]["channels"][number]),
    [directory],
  );
  const { connect, currentServerConnected, currentChannelConnected, isConnected, isConnecting, videoStreams, streamSources } = useSFU();
  const { serverDetailsList, clients, memberLists, serverProfiles } = useSockets();
  const { login } = useAccount();
  /** Servers this app hosts, for Manage server. Empty in a browser. */
  const { servers: hostedServers } = useEmbeddedServer();

  const {
    clientsSpeaking, heldClients: heldHostClients, selfClientId, voiceWidth,
    selectedChannelId, setSelectedChannelId,
    selectedDmId, setSelectedDmId,
    handleVoiceDisconnect, setPendingChannelId, currentChannelId,
    currentConnection, accessToken, serverFailure, hasTimedOut,
    currentConnectionStatus, currentRefusalReason, currentRefusalHelpUrl, reconnectServer,
  } = useServerState();

  const sidebarEditor = useSidebarEditor({ currentlyViewingServer, currentConnection, accessToken, serverDetailsList });
  const {
    editDialogOpen, setEditDialogOpen, setSelectedSidebarItemId,
    effectiveSidebarItems, reorderSidebar, moveSidebarItem, orderResetKey, insertFromPalette,
    pendingDeleteItem, requestDeleteSidebarItem, cancelDelete, confirmDelete,
  } = sidebarEditor;

  useLatencyReporting(currentConnection);
  const peerLatency = usePeerLatency(currentConnection, heldHostClients);

  const {
    voiceFocused, setVoiceFocused, isMaximized, toggleMaximized,
    voiceContainerRef, voiceMaxWidth, shownVoiceWidth,
  } = useVoiceLayout({ setShowVoiceView });

  const [focusedChatHidden, setFocusedChatHidden] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [createChannelType, setCreateChannelType] = useState<"chat" | "voice" | "forum" | "automated">("chat");
  const [createChannelPlacement, setCreateChannelPlacement] = useState<ChannelPlacement>({});
  const toggleFocusedChat = useCallback(() => setFocusedChatHidden((v) => !v), []);

  /** Only means anything while a stream is focused, but it is a press either
      way — which is the difference from what focus used to do on its own. */
  const chatTakenOver = voiceFocused && focusedChatHidden;

  /* Whether the chat pane is drawn at all: the same condition the pane uses
     further down, named because three other things ask it. */
  const chatPaneHidden =
    chatTakenOver || (isMaximized && showVoiceView && voiceWidth !== "0px");

  /* The space shows conversations and a server shows channels, never the other.
     Deciding by "is a DM selected" put Carlo in a server and a channel in the space. */
  const visibleChannelId = dmSpace || chatPaneHidden ? null : selectedChannelId;
  const visibleDmId = !dmSpace || chatPaneHidden ? null : selectedDmId;

  /* What the chat loads, by the same rule. The shared fallback was selectedDmId,
     then the channel, so whichever was set last leaked into the other view. */
  const activeConversationId = dmSpace
    ? (selectedDmId ?? "")
    : (selectedChannelId || currentChannelId || "");

  useEffect(() => {
    if (!currentlyViewingServer) return;
    const opened = visibleDmId || visibleChannelId;
    if (opened) markChannelRead(currentlyViewingServer.host, opened);
  }, [currentlyViewingServer, visibleChannelId, visibleDmId]);

  useEffect(() => {
    setOnScreenConversation(currentlyViewingServer?.host ?? null, visibleDmId || visibleChannelId);
    return () => setOnScreenConversation(null, null);
  }, [currentlyViewingServer?.host, visibleChannelId, visibleDmId]);

  const [searchOpen, setSearchOpen] = useState(false);
  // The messages space searches this device's own copy instead (GRYT-1748).
  const [dmSearchOpen, setDmSearchOpen] = useState(false);
  // The conversation info panel on the right of the messages space (GRYT-1745).
  const [dmInfoOpen, setDmInfoOpen] = useState(true);
  const [askHide, hideDialog] = useConfirmHide();
  const [pendingLeave, setPendingLeave] = useState<{ title: string; leave: () => void } | null>(null);
  const askLeave = (title: string, leave: () => void) => setPendingLeave({ title, leave });
  const { setCameraEnabled } = useCamera();
  const openDmSearch = useCallback(() => {
    setDmSearchOpen(true);
    setSearchFocus((n) => n + 1);
  }, []);
  const [searchFocus, setSearchFocus] = useState(0);
  /* The header's button starts in its channel; Ctrl/Cmd+K starts on the whole server. */
  const [searchStartIn, setSearchStartIn] = useState<SearchFilter | undefined>(undefined);
  const [pendingJump, setPendingJump] = useState<{ conversationId: string; messageId: string; nonce: number } | null>(null);
  // Ctrl/Cmd+K, GRYT-1738. In the messages space it searches this device's copy (GRYT-1748).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== "KeyK") return;
      e.preventDefault();
      if (dmSpace) setDmSearchOpen(true);
      else {
        setSearchStartIn(undefined);
        setSearchOpen(true);
      }
      setSearchFocus((n) => n + 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dmSpace]);

  useEffect(() => {
    const onNotificationChannelOpen = (event: Event) => {
      const { host, channelId } = (
        event as CustomEvent<{ host?: string; channelId?: string }>
      ).detail ?? {};
      if (!host || !channelId || host !== currentlyViewingServer?.host) return;

      const channel = serverDetailsList[host]?.channels?.find(
        (candidate) => candidate.id === channelId,
      );
      if (!channel) return;

      setSelectedDmId(null);
      setSelectedChannelId(channelId);
      setLastSelectedChannelForServer(host, channelId);
    };

    window.addEventListener(
      NOTIFICATION_CHANNEL_OPEN_EVENT,
      onNotificationChannelOpen,
    );
    return () =>
      window.removeEventListener(
        NOTIFICATION_CHANNEL_OPEN_EVENT,
        onNotificationChannelOpen,
      );
  }, [
    currentlyViewingServer?.host,
    serverDetailsList,
    setLastSelectedChannelForServer,
    setSelectedChannelId,
    setSelectedDmId,
  ]);


  const drawnVoicePanelWidth =
    showVoiceView && voiceWidth !== "0px" && !isMaximized && !chatTakenOver
      ? shownVoiceWidth
      : 0;
  /* A thread beside the conversation is a third panel in the row, and the member
     list yields to it the way it already yields to the voice panel. */
  const threadOpen = useOpenThread();
  const threadBeside = useRoomForThreadBeside(drawnVoicePanelWidth);
  const roomForMembers = useRoomForMemberList(
    drawnVoicePanelWidth,
    threadBeside && threadOpen ? THREAD_PANEL_WIDTH : 0,
  );
  const roomForVoice = useRoomForVoicePanel();

  const {
    leftSidebarOpen, rightSidebarOpen,
    leftSidebarContentRef, rightSidebarContentRef,
    openLeftSidebar, closeLeftSidebar, hideLeftSidebarNow, openRightSidebar, closeRightSidebar,
  } = useSidebarHover({ pinChannelsSidebar, pinMembersSidebar, isDraggingResize: false, isCompact, roomForMembers });

  const serverClients = currentlyViewingServer ? heldHostClients : undefined;
  const { mediaAutoShownRef } = useMediaAutoShow({
    showVoiceView, setShowVoiceView, isCompact, roomForVoice, isConnected,
    currentChannelId, serverClients,
  });

  const { applyChannelSettings } = useChannelSettings({
    inputMode, rnnoiseEnabled, eSportsModeEnabled, noiseGate, isConnected,
    setInputMode, setRnnoiseEnabled, setESportsModeEnabled, setNoiseGate,
  });

  const {
    pendingDisconnectUser, setPendingDisconnectUser,
    pendingKickUser, setPendingKickUser,
    pendingBanUser, setPendingBanUser,
    handleDisconnectUser, handleKickUser, handleBanUser, fetchMemberInvite,
    handleServerMuteUser, handleServerDeafenUser, handleToggleRole,
    requestDisconnectUser, requestKickUser, requestBanUser,
  } = useAdminActions({ currentConnection, currentlyViewingServer, accessToken, memberLists });

  const { getUnreadCounts } = useUnreadTracker();
  const { getConversationThreadUnreadCounts } = useThreadUnread();
  const { conversationMentionCount, getMentionCounts } = useMentionTracker();
  const { conversationThreadMentionCount } = useThreadMentions();
  /* Separate from the effect above, which does not fire for a mention landing in
     an open conversation. Timeline only: a thread reply was never on screen. */
  const openConversation = visibleDmId || visibleChannelId || "";
  const openConversationThreadMentions = currentlyViewingServer
    ? conversationThreadMentionCount(currentlyViewingServer.host, openConversation)
    : 0;
  const openTimelineMentions = currentlyViewingServer
    ? conversationMentionCount(currentlyViewingServer.host, openConversation) -
      openConversationThreadMentions
    : 0;

  useEffect(() => {
    if (!currentlyViewingServer || openTimelineMentions <= 0 || !openConversation) return;

    clearMentions(currentlyViewingServer.host, openConversation, openConversationThreadMentions);
    currentConnection?.emit("mentions:seen", { conversationId: openConversation });
  }, [currentlyViewingServer, currentConnection, openTimelineMentions, openConversationThreadMentions, openConversation]);

  const liveServerUserId = currentlyViewingServer && currentConnection?.id
    ? clients[currentlyViewingServer.host]?.[currentConnection.id]?.serverUserId
    : undefined;
  /* Kept through a drop, when the socket has no id: without it a DM typed offline
     decided it could not be sealed and went out in the clear (GRYT-1453). */
  const lastServerUserIdRef = useRef<Record<string, string>>({});
  if (currentlyViewingServer && liveServerUserId) lastServerUserIdRef.current[currentlyViewingServer.host] = liveServerUserId;
  const currentServerUserId =
    liveServerUserId ?? (currentlyViewingServer ? lastServerUserIdRef.current[currentlyViewingServer.host] : undefined);

  /* Ahead of `useChat`, which needs the members to know whether the next message
     can be encrypted. Both unconditional, so the order is free. */
  const {
    conversations: realDirectConversations,
    openDm,
    updateGroup,
    addToGroup,
    leaveGroup,
  } = useDirectMessages({
    socket: currentConnection,
    accessToken,
    isConnected: currentConnectionStatus === "connected",
  });
  // `?fakedms` in dev: the fake conversations open like real ones on the server carrying them.
  const directConversations = useMemo(
    () => (fakeDmsOn && fakeHostNow() === currentlyViewingServer?.host ? [...realDirectConversations, ...fakeConversations()] : realDirectConversations),
    // The directory rebuilds when the fake host is claimed, which is the moment to look again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [realDirectConversations, currentlyViewingServer?.host, directory],
  );
  const { isBlocked, block, unblock } = useBlocks({
    socket: currentConnection,
    accessToken,
    isConnected: currentConnectionStatus === "connected",
  });

  const { reportUser } = useReportUser({ socket: currentConnection, accessToken });
  const [reportTarget, setReportTarget] = useState<{
    serverUserId: string;
    nickname: string;
  } | null>(null);

  /** So a refusal can name the person rather than printing a member id. */
  const memberNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const member of memberLists[currentlyViewingServer?.host || ""] ?? []) {
      names[member.serverUserId] = member.nickname;
    }
    return names;
  }, [memberLists, currentlyViewingServer?.host]);

  const activeConversation = useMemo(
    () => directConversations.find((c) => c.conversation_id === activeConversationId),
    [directConversations, activeConversationId],
  );
  const conversationMembers = activeConversation?.members ?? null;

  const {
    chatMessages, sealing, canSend, sendChat, editMessage, isLoadingMessages,
    isRateLimited, rateLimitCountdown, isVoiceChannelTextChat,
    canViewVoiceChannelText, activeChannelName, activeChannelType, activeChannelAutomated, activeChannelLayout, activeChannelForumTags, activeChannelDescription,
    restoreText, clearRestoreText, fetchOlderMessages, isLoadingOlder, hasOlderMessages, historyWindow,
    plaintextPrompt, confirmPlaintextSend, cancelPlaintextSend,
    mlsNotice, composerHeld, deleteMlsMessage, reactMlsMessage, mlsReportsTaken, archiveFailed, mlsActions,
  } = useChat({
    currentConnection, activeConversationId, currentlyViewingServer,
    currentChannelId, isConnected, serverDetailsList, nickname,
    currentUserId: currentServerUserId,
    conversationMembers,
    dmPeer: activeConversation?.kind === "dm" ? activeConversation.other.server_user_id : null,
    dmPeerName: activeConversation?.other.nickname,
  });
  const mlsView = useMemo(
    () => ({
      notice: mlsNotice,
      held: composerHeld,
      remove: deleteMlsMessage,
      react: reactMlsMessage,
      reportsTaken: mlsReportsTaken,
      archiveFailed,
      actions: mlsActions,
    }),
    [mlsNotice, composerHeld, deleteMlsMessage, reactMlsMessage, mlsReportsTaken, archiveFailed, mlsActions],
  );

  /** The server already withholds new messages, so this covers what was drawn
      when Block was pressed. Filtered here, so unblocking needs no refetch. */
  const visibleChatMessages = useMemo(
    () => chatMessages.filter((m) => !isBlocked(m.sender_server_id)),
    [chatMessages, isBlocked],
  );

  const handleEditItem = useCallback((item: SidebarItem) => {
    setSelectedSidebarItemId(item.id);
    setEditDialogOpen(true);
  }, [setSelectedSidebarItemId, setEditDialogOpen]);

  const handleMoveItem = useCallback((item: SidebarItem, direction: "up" | "down") => {
    const ids = effectiveSidebarItems.map((i) => i.id);
    const idx = ids.indexOf(item.id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= ids.length) return;
    [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
    reorderSidebar(ids);
  }, [effectiveSidebarItems, reorderSidebar]);

  const handleAddItem = useCallback((kind: string, placement?: ChannelPlacement) => {
    // "Add channel" opens the full create modal instead of dropping a default
    // channel that has to be edited after. Folders/spacers stay immediate. GRYT-983.
    if (kind === "channel:text" || kind === "channel:voice") {
      setCreateChannelType(kind === "channel:voice" ? "voice" : "chat");
      const afterItemId = placement?.afterItemId ?? null;
      setCreateChannelPlacement({
        afterItemId,
        folderId: afterItemId ? folderOf(effectiveSidebarItems, afterItemId) : placement?.folderId ?? null,
      });
      setCreateChannelOpen(true);
      return;
    }
    // A folder is named first too, and only exists once Create is pressed (GRYT-1787).
    if (kind === "folder") {
      setNewFolderOpen(true);
      return;
    }
    insertFromPalette(kind, effectiveSidebarItems.length);
  }, [insertFromPalette, effectiveSidebarItems]);

  const viewerPermissions = useServerPermissions(currentlyViewingServer?.host || "");

  const { pendingReportCount, memberListMap } = useServerReports({
    currentConnection, accessToken, currentlyViewingServer, memberLists,
    /* `has`, not `can`: this drives an automatic `reports:list` on join, before
       `server:details` arrives, so `can` made a refusal a new member's first sight. */
    canViewReports: viewerPermissions.has("view_reports"),
  });

  const viewingHost = currentlyViewingServer?.host;
  const [updateAvailable, setUpdateAvailable] = useState(() =>
    viewingHost ? getUpdateAvailable(viewingHost) : false,
  );
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ host: string; updateAvailable: boolean }>).detail;
      if (detail.host === viewingHost) setUpdateAvailable(detail.updateAvailable);
    };
    window.addEventListener("server_update_status", handler);
    setUpdateAvailable(viewingHost ? getUpdateAvailable(viewingHost) : false);
    return () => window.removeEventListener("server_update_status", handler);
  }, [viewingHost]);


  const {
    incoming: incomingCall,
    outgoing: outgoingCall,
    ring: ringConversation,
    decline: declineCall,
    cancel: cancelCall,
    accept: acceptCall,
  } = useCalls({
    socket: currentConnection,
    accessToken,
    isConnected: currentConnectionStatus === "connected",
  });

  /* Conversations are read in the direct messages space, so clicking somebody
     goes there rather than opening one beside this server's channels. */
  const goToConversation = useCallback((conversationId: string) => {
    const host = currentlyViewingServer?.host;
    if (!host) return;
    requestConversation(host, conversationId);
    // This server, so the rail's button comes back here. From inside, it's ignored.
    setDmSpaceOpen(true, { kind: "server", host });
  }, [currentlyViewingServer?.host]);

  /** Waits for `dm:opened` rather than deriving the id, which would mean the
      client owning a rule the server owns and opening empty when they drift. */
  const handleOpenDm = useCallback((targetServerUserId: string) => {
    const existing = directConversations.find(
      (c) => c.other.server_user_id === targetServerUserId,
    );
    if (existing) {
      goToConversation(existing.conversation_id);
      return;
    }
    openDm(targetServerUserId);
  }, [directConversations, openDm, goToConversation]);

  // One opened from the member list was asked for, so it is read too. One the
  // other person started is not, or the view is yanked out from under them.
  const pendingDmTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingDmTargetRef.current;
    if (!target) return;
    const match = directConversations.find((c) => c.other.server_user_id === target);
    if (!match) return;
    pendingDmTargetRef.current = null;
    goToConversation(match.conversation_id);
  }, [directConversations, goToConversation]);

  /* The space's own memory of where it was, which outlives this view unmounting
     on the way to a server and back. The server view already has lastSelectedChannel. */
  useEffect(() => {
    const host = currentlyViewingServer?.host;
    if (dmSpace && host && visibleDmId) rememberConversation(host, visibleDmId);
  }, [dmSpace, currentlyViewingServer?.host, visibleDmId]);

  /* A conversation the direct messages space asked for. Claimed on arrival,
     because that space replaced this view and no event would have landed. */
  const pendingConversation = usePendingConversation();
  useEffect(() => {
    /* The space only. A server view claiming it is how a conversation opened in
       the space turned up in the server's own chat pane. */
    if (!dmSpace) return;
    const host = currentlyViewingServer?.host;
    if (!host) return;
    const wanted = conversationFor(host);
    if (!wanted) return;
    if (selectedDmId === wanted) conversationOpened(wanted);
    else setSelectedDmId(wanted);
  }, [dmSpace, currentlyViewingServer?.host, pendingConversation, selectedDmId, setSelectedDmId]);

  /* Nothing asked for and nothing open is Messages home (GRYT-1744). An empty
     conversation an earlier visit left selected counts as nothing open. GRYT-1148. */
  const visiting = useVisitingConversation();
  useEffect(() => {
    if (!dmSpace) return;
    const host = currentlyViewingServer?.host;
    if (!host || conversationFor(host) || !selectedDmId) return;
    const selected = directory.find((entry) => entry.host === host && entry.conversation.conversation_id === selectedDmId);
    if (leftOver(selected?.conversation, visiting)) setSelectedDmId(null);
  }, [dmSpace, selectedDmId, visiting, currentlyViewingServer?.host, directory, setSelectedDmId]);



  const requestOpenDm = useCallback((targetServerUserId: string) => {
    pendingDmTargetRef.current = targetServerUserId;
    handleOpenDm(targetServerUserId);
  }, [handleOpenDm]);

  /* `window.gryt.dm(nickname)`. The member card this normally starts from does
     not answer a synthetic click, so there is no other way in (GRYT-1115). */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const open = (event: Event) => {
      const wanted = (event as CustomEvent<{ nickname?: string }>).detail?.nickname;
      const id = Object.entries(memberNames).find(([, name]) => name === wanted)?.[0];
      if (!id) {
        console.warn(`[dev] nobody here is called ${wanted}. Have:`, Object.values(memberNames));
        return;
      }
      requestOpenDm(id);
    };
    window.addEventListener("dev_open_dm", open);
    return () => window.removeEventListener("dev_open_dm", open);
  }, [memberNames, requestOpenDm]);

  /** Answering is joining the conversation's voice room; the server ends the ring
      when the join lands. */
  useFakeCallEvents(currentConnection, selectedDmId, fakeCallOptionsFromUrl);

  const handleAcceptCall = useCallback(() => {
    const call = acceptCall();
    if (!call) return;
    if (dmSpace) visitConversation(call.conversation_id);
    setSelectedDmId(call.conversation_id);
    setShowVoiceView(true);
    connect(call.conversation_id).catch((error) => {
      console.error("Could not join the call:", error);
      toast.error(error instanceof Error ? error.message : "Could not join the call");
    });
  }, [acceptCall, connect, dmSpace, setSelectedDmId, setShowVoiceView]);

  const handleSelectDm = useCallback((conversation: { conversation_id: string }) => {
    setSelectedDmId(conversation.conversation_id);
  }, [setSelectedDmId]);

  /* Hiding the one being read points the view at a conversation that has moved
     under the Hidden group, so the selection goes back to the channels. */
  const forgetHiddenDm = useCallback((conversationId: string) => {
    setSelectedDmId((current) => (current === conversationId ? null : current));
  }, [setSelectedDmId]);

  /* Blocking used to take the conversation off the list on the server. It is
     this device's own now, so the block does the same thing here. GRYT-1379. */
  const blockAndHide = useCallback((targetServerUserId: string) => {
    block(targetServerUserId);
    const viewingHost = currentlyViewingServer?.host;
    const found = directConversations.find(
      (c) => c.kind !== "group" && c.other?.server_user_id === targetServerUserId,
    );
    if (!viewingHost || !found) return;
    hideConversation(viewingHost, currentServerUserId ?? "", found.conversation_id);
    forgetHiddenDm(found.conversation_id);
  }, [block, currentlyViewingServer, directConversations, forgetHiddenDm, currentServerUserId]);

  /** The group whose settings are open, or null. Starting one is the + next to
      Messages, in `NewMessageDialog`. */
  const [groupDialog, setGroupDialog] = useState<DirectConversation | null>(null);


  const activeDm = useMemo(
    () => (dmSpace && selectedDmId
      ? directConversations.find((c) => c.conversation_id === selectedDmId)
      : undefined),
    [dmSpace, selectedDmId, directConversations],
  );
  // While you're in this conversation's call its header says so, and brings the call back (board 11).
  const inThisCall = !!activeDm && isConnected && currentServerConnected === currentlyViewingServer?.host && currentChannelConnected === activeDm?.conversation_id;
  const callSeconds = useCallClock(inThisCall, activeDm?.conversation_id ?? "");

  /* A DM call shows beside its own conversation only. Opening another one puts the call in
     the rail capsule, and coming back to it brings the call back (board 14). */
  const dmCallId =
    dmSpace && isConnected && currentServerConnected === currentlyViewingServer?.host && currentChannelConnected &&
    !(currentlyViewingServer ? serverDetailsList[currentlyViewingServer.host]?.channels ?? [] : []).some((c) => c.id === currentChannelConnected)
      ? currentChannelConnected
      : null;
  const callTuckedAway = useRef(false);
  useEffect(() => {
    if (!dmCallId) {
      callTuckedAway.current = false;
      return;
    }
    const onCall = activeDm?.conversation_id === dmCallId;
    if (!onCall && showVoiceView) {
      callTuckedAway.current = true;
      setShowVoiceView(false);
    } else if (onCall && callTuckedAway.current) {
      callTuckedAway.current = false;
      setShowVoiceView(true);
    }
  }, [dmCallId, activeDm?.conversation_id, showVoiceView, setShowVoiceView]);

  /* The call, the chat and the panel don't fit side by side, so the panel steps aside for
     the call and comes back when it ends. */
  const infoBeforeCall = useRef<boolean | null>(null);
  useEffect(() => {
    if (inThisCall && infoBeforeCall.current === null) {
      infoBeforeCall.current = dmInfoOpen;
      setDmInfoOpen(false);
    } else if (!inThisCall && infoBeforeCall.current !== null) {
      setDmInfoOpen(infoBeforeCall.current);
      infoBeforeCall.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inThisCall]);

  /* The conversation the tiny window's list was opened over. Picking another one
     moves the selection off it, so the list goes without being told. */
  const [tinyListOver, setTinyListOver] = useState<string | null>(null);
  const showTinyList = isTiny && dmSpace && (!activeDm || tinyListOver === activeDm.conversation_id);

  const openFromTinyList = useCallback((conversation: { conversation_id: string }) => {
    setTinyListOver(null);
    handleSelectDm(conversation);
  }, [handleSelectDm]);

  /** A lookup, not a test on the id, since a channel can be named to look like
      one. `currentChannelId` is the room joined, not the one on screen. */
  const connectedToACall = useMemo(
    () => Boolean(currentChannelId)
      && directConversations.some((c) => c.conversation_id === currentChannelId),
    [currentChannelId, directConversations],
  );
  useEffect(() => setInACall(connectedToACall), [connectedToACall]);

  const handleChannelClick = useHandleChannelClick({
    currentlyViewingServer, isConnected, currentServerConnected,
    currentChannelId, selectedChannelId, isConnecting,
    showVoiceView, mediaAutoShownRef,
    setSelectedChannelId, setShowVoiceView, setPendingChannelId,
    setSettingsTab, setShowSettings, setLastSelectedChannelForServer,
    connect, applyChannelSettings, setIsMuted, setIsDeafened,
  });

  // Join from an In voice tile on Messages home, once that server is the one on screen.
  const pendingVoiceJoin = usePendingVoiceJoin();
  useEffect(() => {
    const host = currentlyViewingServer?.host;
    if (!host || dmSpace || pendingVoiceJoin?.host !== host) return;
    const channelId = takeVoiceJoin(host);
    const channel = serverDetailsList[host]?.channels?.find((c) => c.id === channelId);
    if (channel) handleChannelClick(channel);
  }, [pendingVoiceJoin, currentlyViewingServer?.host, dmSpace, serverDetailsList, handleChannelClick]);

  // Without this the DM stays the active conversation and the channel looks
  // selected while showing somebody else's messages.
  const handleChannelClickAndCloseDm = useCallback((channel: Parameters<typeof handleChannelClick>[0]) => {
    setSelectedDmId(null);
    handleChannelClick(channel);
  }, [handleChannelClick, setSelectedDmId]);

  /** A ring carries a nickname and nothing else, or a person's appearance is a
      second copy to go stale. A caller not in the list draws from the name. */
  const caller = incomingCall ? memberListMap[incomingCall.from.server_user_id] : undefined;
  const callerAvatarUrl =
    caller?.avatarFileId && viewingHost
      ? getUploadsFileUrl(viewingHost, caller.avatarFileId, { thumb: true })
      : undefined;
  const callerAvatarWorn = caller?.avatarWorn ?? null;

  const dmPins = usePins(currentConnection, dmSpace && activeDm ? activeDm.conversation_id : "", currentlyViewingServer?.host);

  /** The caller is in the room from the moment it rings, or answering joins a
      room with nobody in it. Cancel is offered until somebody answers. */
  const startCall = useCallback((conversationId: string) => {
    ringConversation(conversationId);
    setShowVoiceView(true);
    connect(conversationId).catch((error) => {
      console.error("Could not start the call:", error);
      // The same id as a refused ring, so their call setting is said once (GRYT-1470).
      toast.error(error instanceof Error ? error.message : "Could not start the call", { id: "call:start" });
      cancelCall(conversationId);
    });
  }, [ringConversation, setShowVoiceView, connect, cancelCall]);

  // Call from a friend's menu on Messages home: rung once their conversation is the open one.
  useEffect(() => {
    if (!activeDm || activeDm.kind !== "dm" || !viewingHost) return;
    if (takeCallRequest(viewingHost, activeDm.other.server_user_id)) startCall(activeDm.conversation_id);
  }, [activeDm, viewingHost, startCall]);

  /** Built once for both layouts. Calling is offered whether or not one is
      going, and `start_calls` is not the permission for answering. */
  const dmHeaderActions = useMemo(() => {
    if (!activeDm) return undefined;
    const conversationId = activeDm.conversation_id;
    const ringing = outgoingCall?.conversation_id === conversationId;
    const mayCall = viewerPermissions.can("send_direct_messages") && viewerPermissions.can("start_calls");
    const friendWith = activeDm.kind === "dm" ? activeDm.other.server_user_id : undefined;

    const stopCall = () => {
      cancelCall(conversationId);
      handleVoiceDisconnect();
    };

    // Board 1: call, video, search, and the info panel. Friends and group settings are in the panel.
    if (!isTiny && !isMobile) {
      const icon = (label: string, onClick: () => void, child: ReactNode, pressed?: boolean, dataGryt?: string) => (
        <Tooltip title={label}>
          <IconButton aria-label={label} aria-pressed={pressed} data-gryt={dataGryt} size="small" tone={pressed ? "neutral" : "ghost"} onClick={onClick}>
            {child}
          </IconButton>
        </Tooltip>
      );
      if (inThisCall) {
        return (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              data-gryt="in-call-pill"
              onClick={() => setShowVoiceView(true)}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-(--gryt-radius-full) border-0 px-3 text-[13px] font-semibold tabular-nums"
              style={{ background: "var(--gryt-success-3)", boxShadow: "inset 0 0 0 1px var(--gryt-success-6)", color: "var(--gryt-success-11)" }}
            >
              <PiPhoneFill size={14} /> In the call · {callClock(callSeconds)}
            </button>
            {icon("Search messages", () => (dmSearchOpen ? setDmSearchOpen(false) : openDmSearch()), <PiMagnifyingGlassBold size={17} />, dmSearchOpen)}
            {icon("Conversation info", () => {
              setDmInfoOpen(!dmInfoOpen || dmSearchOpen);
              setDmSearchOpen(false);
            }, <PiSidebarSimpleFill size={17} style={{ transform: "scaleX(-1)" }} />, dmInfoOpen && !dmSearchOpen, "dm-info-toggle")}
          </div>
        );
      }
      return (
        <div className="flex items-center gap-0.5">
          {mayCall && (ringing
            ? <Button size="small" tone="primary" onClick={stopCall}>Cancel</Button>
            : icon("Call", () => startCall(conversationId), <PiPhoneFill size={17} />))}
          {mayCall && !ringing && icon("Video call", () => {
            startCall(conversationId);
            setCameraEnabled(true);
          }, <PiCameraFill size={17} />)}
          {icon("Search messages", () => (dmSearchOpen ? setDmSearchOpen(false) : openDmSearch()), <PiMagnifyingGlassBold size={17} />, dmSearchOpen)}
          {icon("Conversation info", () => {
            setDmInfoOpen(!dmInfoOpen || dmSearchOpen);
            setDmSearchOpen(false);
          }, <PiSidebarSimpleFill size={17} style={{ transform: "scaleX(-1)" }} />, dmInfoOpen && !dmSearchOpen, "dm-info-toggle")}
        </div>
      );
    }

    return (
      <div className="flex items-center gap-1">
        <FriendButton host={viewingHost} serverUserId={friendWith} compact />
        {mayCall ? (
          <Button
            size="small"
            tone={ringing ? "primary" : "ghost"}
            onClick={() => (ringing ? stopCall() : startCall(conversationId))}
          >
            {ringing ? "Cancel" : "Call"}
          </Button>
        ) : null}
        {/* The only way into a group's settings since its section left the channel list.
            An icon, so a 300px window still has room for the group's name. */}
        {activeDm.kind === "group" ? (
          <Tooltip title="Group settings">
            <IconButton aria-label="Group settings" size="xsmall" tone="ghost" onClick={() => setGroupDialog(activeDm)}>
              <PiGearSixFill size={16} />
            </IconButton>
          </Tooltip>
        ) : null}
      </div>
    );
  }, [activeDm, viewerPermissions, outgoingCall, cancelCall, startCall, setGroupDialog, handleVoiceDisconnect, viewingHost, isTiny, isMobile, dmSearchOpen, dmInfoOpen, openDmSearch, setCameraEnabled, inThisCall, callSeconds, setShowVoiceView]);

  /* The same member list the sidebar reads presence off — someone it hides
     from this viewer has no entry here either (GRYT-1467). */
  const dmPresence = useMemo(() => {
    if (!activeDm) return undefined;
    if (activeDm.kind === "dm") {
      const status = memberListMap[activeDm.other.server_user_id]?.status;
      if (!status) return undefined;
      const { label } = statusConfig[status];
      return (
        <span className="flex shrink-0 items-center gap-1.5 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
          <PresenceDot status={status} size={8} />
          {label}
        </span>
      );
    }
    const known = activeDm.members
      .map((m) => memberListMap[m.server_user_id]?.status)
      .filter((status): status is NonNullable<typeof status> => Boolean(status));
    // Nobody in the member list at all reads as "no data" rather than "0 online".
    if (known.length === 0) return undefined;
    const online = known.filter((status) => status !== "offline").length;
    return (
      <span className="shrink-0 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
        {online} online
      </span>
    );
  }, [activeDm, memberListMap]);

  /* Memoized like the actions: ChatView is memo'd, and a fresh element every render undoes it. */
  const dmHeaderDetail = useMemo(() => {
    if (!activeDm || !currentlyViewingServer) return undefined;
    const { host, name: stored } = currentlyViewingServer;
    const name = serverDetailsList[host]?.server_info?.name || stored || host;
    return (
      <>
        {dmPresence}
        <ServerChip name={name} icon={serverIconSrc(host, stored || "", serverDetailsList)} />
      </>
    );
  }, [activeDm, currentlyViewingServer, serverDetailsList, dmPresence]);

  /* Board 1's header: the face where a channel has its icon, and under the name where
     the conversation lives and whether it's sealed. */
  const dmHeaderIcon = useMemo(() => {
    if (!activeDm || !viewingHost) return undefined;
    if (activeDm.kind === "group") return <GroupFace host={viewingHost} conversation={activeDm} size={36} />;
    const status = memberListMap[activeDm.other.server_user_id]?.status;
    return (
      <span className="relative inline-flex shrink-0">
        <Avatar
          size="small"
          className="h-9 w-9"
          fallback={activeDm.other.nickname[0]}
          src={resolveAvatarSrc(
            activeDm.other.avatar_file_id ? getUploadsFileUrl(viewingHost, activeDm.other.avatar_file_id, { thumb: true }) : undefined,
            activeDm.other.nickname,
            activeDm.other.avatar_worn,
          )}
        />
        {status && (
          <span className="absolute rounded-(--gryt-radius-full)" style={{ bottom: -1, right: -1, padding: 2.5, background: "var(--gryt-neutral-2)" }}>
            <PresenceDot status={status} size={9} />
          </span>
        )}
      </span>
    );
  }, [activeDm, viewingHost, memberListMap]);

  const dmHeaderSubtitle = useMemo(() => {
    if (!activeDm || !currentlyViewingServer) return undefined;
    const { host, name: stored } = currentlyViewingServer;
    const name = serverDetailsList[host]?.server_info?.name || stored || host;
    const sealed = sealing?.kind === "seal";
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
        {activeDm.kind === "group" ? <span>{activeDm.members.length + 1} people ·</span> : <span>on</span>}
        <ServerChip name={name} icon={serverIconSrc(host, stored || "", serverDetailsList)} />
        <span aria-hidden>·</span>
        {sealed ? (
          <>
            <PiShieldCheckFill size={11} aria-hidden />
            <span>Encrypted</span>
          </>
        ) : (
          /* Boards 5b and 5c: why, what to do, and turning the dots off. */
          <NotEncryptedPopover
            decision={sealing}
            serverName={name}
            host={host}
            conversationId={activeDm.conversation_id}
            memberNames={memberNames}
            onAsk={(text) => sendChat(text, [])}
            onCompare={() => setDmInfoOpen(true)}
          />
        )}
      </span>
    );
  }, [activeDm, currentlyViewingServer, serverDetailsList, sealing, memberNames, sendChat]);

  /* Board 7, option A: behind ⋯ in a channel's header. The pin button stays beside it. */
  const channelMoreMenu = useMemo(() => {
    if (activeDm || !viewingHost || !visibleChannelId || isTiny || isMobile) return undefined;
    return (
      <>
        {/* Both side panels, together: they're about this view, not the server (GRYT-1781). */}
        <Menu.Item
          onClick={() => {
            if (pinChannelsSidebar) hideLeftSidebarNow();
            setPinChannelsSidebar(!pinChannelsSidebar);
          }}
        >
          <PiSidebarSimpleFill size={16} /> {pinChannelsSidebar ? "Hide channels" : "Keep channels open"}
        </Menu.Item>
        {viewerPermissions.can("view_members") && (
          <Menu.Item onClick={() => setPinMembersSidebar(!pinMembersSidebar)}>
            <PiSidebarSimpleFill size={16} style={{ transform: "scaleX(-1)" }} /> {pinMembersSidebar ? "Hide members" : "Keep members open"}
          </Menu.Item>
        )}
        <Menu.Separator />
        <NotificationLevelMenu
          host={viewingHost}
          scope={{ kind: "channel", id: visibleChannelId }}
          placement={{
            channelId: visibleChannelId,
            parentItemId: effectiveSidebarItems.find((i) => (i.channelId ?? i.id) === visibleChannelId)?.parentItemId ?? null,
          }}
          inMenu
        />
      </>
    );
  }, [activeDm, viewingHost, visibleChannelId, isTiny, isMobile, viewerPermissions, pinMembersSidebar, setPinMembersSidebar, pinChannelsSidebar, setPinChannelsSidebar, hideLeftSidebarNow, effectiveSidebarItems]);

  const tinyBack = useMemo(() => {
    if (!isTiny || !dmSpace || !activeDm) return undefined;
    const over = activeDm.conversation_id;
    return (
      <Tooltip title="Back to messages">
        <IconButton aria-label="Back to messages" size="xsmall" tone="ghost" onClick={() => setTinyListOver(over)}>
          <PiCaretLeftBold size={16} />
        </IconButton>
      </Tooltip>
    );
  }, [isTiny, dmSpace, activeDm]);

  const currentAdminActions = useMemo(() => {
    // One handler per permission, not a bundle per role name, which gave a role
    // built for one of these a menu with none. Undefined, not hidden.
    const can = viewerPermissions.can;
    const any =
      can("disconnect_members") ||
      can("kick_members") ||
      can("ban_members") ||
      can("mute_members") ||
      can("deafen_members") ||
      can("manage_roles");
    if (!any) return undefined;

    return {
      onDisconnectUser: can("disconnect_members") ? requestDisconnectUser : undefined,
      onKickUser: can("kick_members") ? requestKickUser : undefined,
      onBanUser: can("ban_members") ? requestBanUser : undefined,
      onServerMuteUser: can("mute_members") ? handleServerMuteUser : undefined,
      onServerDeafenUser: can("deafen_members") ? handleServerDeafenUser : undefined,
      onToggleRole: can("manage_roles") ? handleToggleRole : undefined,
    };
  }, [viewerPermissions, requestDisconnectUser, requestKickUser, requestBanUser, handleServerMuteUser, handleServerDeafenUser, handleToggleRole]);

  // Dev only, and above the early returns because the speech rig is a hook.
  // See fakeParticipants.ts.
  const fakeParticipantOptions = useMemo(
    () =>
      fakeParticipantOptionsFromUrl ??
      fakeParticipantOptionsFromSettings(
        devFakeParticipants,
        devFakeMembers,
        devFakeMuted,
        devFakeScreenShare,
        devFakeDeafened,
        devFakeSpeaking,
      ),
    [devFakeParticipants, devFakeMembers, devFakeMuted, devFakeScreenShare, devFakeDeafened, devFakeSpeaking],
  );
  const fakeSpeech = useFakeSpeech(fakeParticipantOptions);

  // Dev only. The same invented people the voice fixture uses, so a message and a
  // tile belong to one person.
  const fakeChatRunning = useFakeChatRunning();
  const fakeChatSenders = useMemo(
    () => fakeChatSendersFrom(fakeParticipantOptions),
    [fakeParticipantOptions],
  );

  /* All of them: one emoji used for everything looks like a stuck key rather
     than a server with its own. */
  const fakeChatEmojiNames = useMemo(
    () => getCustomEmojis().map((e) => e.name),
    [],
  );
  useFakeChat({
    running: fakeChatRunning,
    connection: currentConnection,
    conversationId: activeConversationId,
    senders: fakeChatSenders,
    selfNickname: nickname,
    emojiNames: fakeChatEmojiNames,
    everySeconds: devFakeChatSeconds,
  });

  /* Everything a member card can do here, for every card on this server at once. */
  const cardRole = serverDetailsList[currentlyViewingServer?.host ?? ""]?.server_info?.role;
  const memberCardActions = useMemo<MemberCardActions>(
    () => ({
      currentServerUserId,
      currentUserRole: cardRole,
      adminActions: currentAdminActions,
      onOpenDm: requestOpenDm,
      isBlocked,
      onToggleBlock: (id: string) => (isBlocked(id) ? unblock : blockAndHide)(id),
      onReport: setReportTarget,
    }),
    [currentServerUserId, cardRole, currentAdminActions, requestOpenDm, isBlocked, unblock, blockAndHide],
  );

  if (!currentlyViewingServer) return null;

  const serverDetails = serverDetailsList[currentlyViewingServer.host];
  const serverNickname = serverProfiles[currentlyViewingServer.host]?.nickname || nickname;
  const channelById = new Map((serverDetails?.channels || []).map((c) => [c.id, c]));

  // Never reached this session, so there are no channels to dim (board 9, GRYT-1751).
  if (!serverDetails && !serverFailure && currentConnectionStatus === "disconnected") {
    return (
      <UnreachableServer
        host={currentlyViewingServer.host}
        serverName={currentlyViewingServer.name || currentlyViewingServer.host}
        sfuHosts={[]}
        stunHosts={[]}
        onTryNow={() => reconnectServer(currentlyViewingServer.host)}
      />
    );
  }

  if (!serverDetails) {
    return (
      <ServerLoadingStates
        serverFailure={serverFailure} hasTimedOut={hasTimedOut}
        connectionStatus={currentConnectionStatus}
        refusalReason={currentRefusalReason}
        refusalHelpUrl={currentRefusalHelpUrl}
        onReconnect={() => reconnectServer(currentlyViewingServer.host)}
        onSignIn={() => void login()}
        onResumeHere={() => {
          // Clearing comes first: reconnecting triggers a challenge, and the
          // handler refuses to answer while the note stands.
          clearSignedOut(currentlyViewingServer.host);
          reconnectServer(currentlyViewingServer.host);
        }}
      />
    );
  }

  const host = currentlyViewingServer.host;
  const unreadCounts = getUnreadCounts(host);
  const threadUnreadCounts = getConversationThreadUnreadCounts(host);
  const mentionCounts = getMentionCounts(host);
  const isServerUnreachable = currentConnectionStatus === "disconnected" || currentConnectionStatus === "reconnecting";
  const isVoiceOnThisServer = isConnected && currentServerConnected === host;
  const currentUserRole = serverDetails?.server_info?.role;
  // Editing the sidebar is `manage_channels`; pulling somebody out of voice is
  // voice moderation. One question could not tell a role built for one.
  const canManage = viewerPermissions.can("manage_channels");
  const canDisconnectFromVoice = viewerPermissions.can("disconnect_members");
  const canViewMembers = viewerPermissions.can("view_members");

  const hostChannels = serverDetails.channels || [];



  const { clients: hostClients, videoStreams: voiceVideoStreams } =
    withFakeParticipants(
      heldHostClients,
      videoStreams,
      currentChannelId,
      fakeParticipantOptions,
    );
  // Empty unless the fakes are on, so the real values pass through untouched.
  const voiceStreamSources = fakeParticipantOptions
    ? { ...streamSources, ...fakeSpeech.sources }
    : streamSources;
  const voiceClientsSpeaking = fakeParticipantOptions
    ? { ...clientsSpeaking, ...fakeSpeech.speaking }
    : clientsSpeaking;
  const hostMembers = withFakeMembers(
    memberLists[host] || [],
    currentChannelId,
    fakeParticipantOptions,
  );
  const serverName = serverDetails.server_info?.name || currentlyViewingServer.name;

  const onOpenSettings = () => {
    window.dispatchEvent(new CustomEvent("server_settings_open", { detail: { host } }));
  };

  /* The modal drops back to overview when the permission is missing, so asking
     for a tab here does not need to check first. */
  const onOpenInvites = () => {
    window.dispatchEvent(
      new CustomEvent("server_settings_open", { detail: { host, tab: "invites" } }),
    );
  };

  const hostedHere = hostedServerAt(host, hostedServers);
  const onManageServer = hostedHere
    ? () => openSettings(manageServerTab(hostedHere.id))
    : undefined;



  /** One element for two layouts: the tiny window renders this and nothing else,
      and a second copy is thirty props to keep in step. */
  const reachLine = connectionLine(currentConnectionStatus, isServerUnreachable, serverName || host);
  const narrowDmDetail = isTiny || isMobile ? dmHeaderDetail : undefined;
  const wideOrMobile = isMobile ? "mobile" : "wide";
  const layout = isTiny ? "tiny" : wideOrMobile;
  const sidePanel = sidePanelOf({ searchOpen, dmSpace, dmSearchOpen, activeDm: !!activeDm, isTiny });
  const chatView = dmSpace && !activeDm ? (
    <MessagesHome onSearch={openDmSearch} />
  ) : (
      <ChatView
        offlineLine={reachLine?.long}
        /* Wide enough for the thread to sit beside the conversation rather than
           take the chat pane. */
        threadBeside={threadBeside}
        /* Under the header, not above: above is app chrome, and this is somebody
           else's machine talking. */
        underHeader={
          <ServerNoticePanel
            host={currentlyViewingServer?.host}
            serverName={
              currentlyViewingServer?.name || currentlyViewingServer?.host || "this server"
            }
          />
        }
        chatMessages={visibleChatMessages}
        isBlocked={isBlocked}
        conversationKey={activeConversationId}
        sealing={activeDm ? sealing : undefined}
        mls={activeDm ? mlsView : undefined}
        canSend={canSend}
        sendChat={sendChat}
        editMessage={editMessage}
        currentUserId={currentServerUserId}
        channelName={activeDm ? conversationTitle(activeDm) : activeChannelName}
        channelType={activeChannelType}
        automated={!activeDm && activeChannelAutomated}
        layout={activeDm ? "chat" : activeChannelLayout}
forumTags={activeDm ? [] : activeChannelForumTags}
        conversationKind={activeDm ? "dm" : "channel"}
        headerAction={dmHeaderActions}
        headerLead={tinyBack}
        headerDetail={activeDm ? narrowDmDetail : <ChannelDescription text={activeChannelDescription} />}
        headerIcon={activeDm && !isTiny && !isMobile ? dmHeaderIcon : undefined}
        headerSubtitle={activeDm && !isTiny && !isMobile ? dmHeaderSubtitle : undefined}
        moreMenu={channelMoreMenu}
        hidePins={!!activeDm && !isTiny && !isMobile}
        flush={isTiny}
        serverName={serverName}
        currentUserNickname={serverNickname}
        socketConnection={currentConnection}
        serverHost={host}
        memberList={memberListMap}
        isRateLimited={isRateLimited}
        rateLimitCountdown={rateLimitCountdown}
        canViewVoiceChannelText={canViewVoiceChannelText}
        isVoiceChannelTextChat={isVoiceChannelTextChat}
        restoreText={restoreText}
        clearRestoreText={clearRestoreText}
        canDeleteAny={viewerPermissions.canIn(activeConversationId, "manage_messages")}
        maxFileSize={serverDetails.server_info?.upload_max_bytes}
        onLoadOlder={fetchOlderMessages}
        isLoadingOlder={isLoadingOlder}
        hasOlderMessages={hasOlderMessages}
        historyWindow={historyWindow}
        onSearch={dmSpace || isTiny || isMobile ? undefined : () => {
          setSearchStartIn(visibleChannelId ? { key: "in", value: visibleChannelId, label: `#${activeChannelName}` } : undefined);
          setSearchOpen((open) => !open);
          setSearchFocus((n) => n + 1);
        }}
        pendingJump={pendingJump}
        {...(isLoadingMessages !== undefined && { isLoadingMessages })}
      />
  );

  /* Gave up reconnecting. A call still running here keeps the view, since its
     controls are in it; otherwise the same card as a server never reached. */
  if (currentConnectionStatus === "disconnected" && !isVoiceOnThisServer) {
    return (
      <UnreachableServer
        host={host}
        serverName={serverName || host}
        sfuHosts={serverDetails.sfu_hosts ?? (serverDetails.sfu_host ? [serverDetails.sfu_host] : [])}
        stunHosts={serverDetails.stun_hosts ?? []}
        onTryNow={() => reconnectServer(host)}
      />
    );
  }

  return (
    <MemberCardActionsContext.Provider value={memberCardActions}>
      {/* min-w-0, or a header's one-line name sets the narrowest this can get. */}
      <div className="flex w-full h-full min-w-0 gap-4 flex-col" data-gryt="server-view">
        {/* Not in the direct messages space, where the server behind it isn't what's on screen. */}
        {!dmSpace && currentConnectionStatus === "connected" && (
          <SecurityNoticeBanner host={host} serverInfo={serverDetails.server_info} hostedHere={!!hostedHere} />
        )}
        {layout === "tiny" && (
          /* One channel and no way to change it; the way out is a bigger window.
             A call is the exception, or the microphone has no button to close it. */
          <div className="flex" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            {/* In the direct messages space, the list and a conversation take turns filling the window. */}
            {showTinyList ? (
              <DmSpaceSidebar host={host} selectedConversationId={visibleDmId} onOpen={openFromTinyList} onHidden={forgetHiddenDm} fill />
            ) : chatView}
            <VoiceSheetButton
              connected={isVoiceOnThisServer}
              serverHost={host}
              currentServerConnected={currentServerConnected}
              currentChannelId={currentChannelId}
              clientsForHost={hostClients}
              members={hostMembers}
              clientsSpeaking={voiceClientsSpeaking}
              isConnecting={isConnecting}
              currentConnectionId={selfClientId}
              isCall={connectedToACall}
              onDisconnect={handleVoiceDisconnect}
              peerLatency={peerLatency}
              onDisconnectUser={canDisconnectFromVoice ? requestDisconnectUser : undefined}
              currentUserRole={currentUserRole}
              adminActions={currentAdminActions}
              videoStreams={voiceVideoStreams}
              streamSources={voiceStreamSources}
            />
          </div>
        )}
        {layout === "mobile" && (
          <MobileServerView
            dmSpace={dmSpace}
            onOpenDm={requestOpenDm}
            serverName={serverName}
            serverRole={currentUserRole}
            isServerUnreachable={isServerUnreachable}
            isConnectedToVoiceOnThisServer={isVoiceOnThisServer}
            onOpenSettings={onOpenSettings}
            onOpenInvites={onOpenInvites}
            onManageServer={onManageServer}
            pendingReportCount={pendingReportCount}
            updateAvailable={updateAvailable}
            onLeave={(mode) => setShowRemoveServer({ host, mode })}
            channels={hostChannels}
            sidebarItems={effectiveSidebarItems}
            serverHost={host}
            clients={hostClients}
            members={hostMembers}
            currentChannelId={currentChannelId}
            currentServerConnected={currentServerConnected}
            showVoiceView={showVoiceView}
            isConnecting={isConnecting}
            currentConnectionId={selfClientId}
            selectedChannelId={visibleChannelId}
            onChannelClick={handleChannelClickAndCloseDm}
            selectedDmId={visibleDmId}
            onSelectDm={handleSelectDm}
            clientsSpeaking={voiceClientsSpeaking}
            canManage={canManage}
            onEditItem={handleEditItem}
            onDeleteItem={requestDeleteSidebarItem}
            onMoveItem={handleMoveItem}
            onReorder={moveSidebarItem}
            orderResetKey={orderResetKey}
            onAddItem={handleAddItem}
            onDisconnectUser={canDisconnectFromVoice ? requestDisconnectUser : undefined}
            currentUserRole={currentUserRole}
            adminActions={currentAdminActions}
            unreadCounts={unreadCounts}
            threadUnreadCounts={threadUnreadCounts}
            mentionCounts={mentionCounts}
            chatMessages={visibleChatMessages}
            sealing={activeDm ? sealing : undefined}
            mls={activeDm ? mlsView : undefined}
            canSend={canSend}
            sendChat={sendChat}
            editMessage={editMessage}
            currentUserId={currentServerUserId}
            channelName={activeDm ? conversationTitle(activeDm) : activeChannelName}
            channelType={activeChannelType}
            automated={!activeDm && activeChannelAutomated}
            layout={activeDm ? "chat" : activeChannelLayout}
forumTags={activeDm ? [] : activeChannelForumTags}
            conversationKind={activeDm ? "dm" : "channel"}
            headerAction={dmHeaderActions}
            headerDetail={activeDm ? dmHeaderDetail : <ChannelDescription text={activeChannelDescription} />}
            currentUserNickname={serverNickname}
            socketConnection={currentConnection}
            memberList={memberListMap}
            isRateLimited={isRateLimited}
            rateLimitCountdown={rateLimitCountdown}
            canViewVoiceChannelText={canViewVoiceChannelText}
            isVoiceChannelTextChat={isVoiceChannelTextChat}
            isLoadingMessages={isLoadingMessages}
            restoreText={restoreText}
            clearRestoreText={clearRestoreText}
            canDeleteAny={viewerPermissions.canIn(activeConversationId, "manage_messages")}
            maxFileSize={serverDetails.server_info?.upload_max_bytes}
            onLoadOlder={fetchOlderMessages}
            isLoadingOlder={isLoadingOlder}
            hasOlderMessages={hasOlderMessages}
            historyWindow={historyWindow}
            voiceWidth={voiceWidth}
            clientsForHost={hostClients}
            isCall={connectedToACall}
            onVoiceDisconnect={handleVoiceDisconnect}
            peerLatency={peerLatency}
            videoStreams={voiceVideoStreams}
            streamSources={voiceStreamSources}
          />
        )}
        {layout === "wide" && (
          <div className="flex w-full gap-4" style={{
              flex: 1, overflow: "hidden",
            }}>
            {dmSpace ? (
              /* Folds like the channel list, on the same setting: one left list, one choice. */
              <div
                role="navigation"
                aria-label="Direct messages"
                onMouseEnter={openLeftSidebar}
                onMouseLeave={closeLeftSidebar}
                style={{ flexShrink: 0, display: "flex" }}
              >
                <motion.div
                  animate={{ width: leftSidebarOpen ? DM_LIST_WIDTH_PX : 0 }}
                  initial={false}
                  transition={{ type: "spring", stiffness: 380, damping: 34 }}
                  style={{ overflow: "hidden", display: "flex" }}
                >
                  <DmSpaceSidebar
                    host={host}
                    selectedConversationId={visibleDmId}
                    onOpen={handleSelectDm}
                    onHidden={forgetHiddenDm}
                    listPinned={pinChannelsSidebar}
                    onToggleList={() => {
                if (pinChannelsSidebar) hideLeftSidebarNow();
                setPinChannelsSidebar(!pinChannelsSidebar);
              }}
                  />
                </motion.div>
                <motion.div
                  aria-hidden
                  data-gryt="dm-list-grip"
                  animate={{ width: leftSidebarOpen ? 0 : SIDEBAR_HOVER_PX }}
                  initial={false}
                  style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
                >
                  <span style={{ width: 4, height: "33%", borderRadius: 9999, background: "var(--gryt-neutral-a4)", opacity: 0.5 }} />
                </motion.div>
              </div>
            ) : (
            <ServerSidebar
              sidebarOpen={leftSidebarOpen}
              sidebarWidthPx={SIDEBAR_WIDTH_PX}
              hoverPx={SIDEBAR_HOVER_PX}
              contentRef={leftSidebarContentRef}
              isUnreachableWhileConnected={isServerUnreachable}
              statusLine={reachLine?.short}
              onMouseEnter={openLeftSidebar}
              onMouseLeave={closeLeftSidebar}
              serverName={serverName}
              serverRole={currentUserRole}
              onOpenSettings={onOpenSettings}
              onOpenInvites={onOpenInvites}
              onManageServer={onManageServer}
              pendingReportCount={pendingReportCount}
              updateAvailable={updateAvailable}
              onLeave={(mode) => setShowRemoveServer({ host, mode })}
              channels={hostChannels}
              sidebarItems={effectiveSidebarItems}
              serverHost={host}
              clients={hostClients}
              members={hostMembers}
              currentChannelId={currentChannelId}
              currentServerConnected={currentServerConnected}
              showVoiceView={showVoiceView}
              isConnecting={isConnecting}
              currentConnectionId={selfClientId}
              selectedChannelId={visibleChannelId}
              onChannelClick={handleChannelClickAndCloseDm}
              clientsSpeaking={voiceClientsSpeaking}
              canManage={canManage}
              onEditItem={handleEditItem}
              onDeleteItem={requestDeleteSidebarItem}
              onMoveItem={handleMoveItem}
              onReorder={moveSidebarItem}
              orderResetKey={orderResetKey}
              onAddItem={handleAddItem}
              onDisconnectUser={canDisconnectFromVoice ? requestDisconnectUser : undefined}
              currentUserRole={currentUserRole}
              adminActions={currentAdminActions}
              unreadCounts={unreadCounts}
              threadUnreadCounts={threadUnreadCounts}
              mentionCounts={mentionCounts}
              streamSources={voiceStreamSources}
            />
            )}
            <div className="flex grow" ref={voiceContainerRef} style={{ position: "relative", minWidth: 0 }}>
              <VoiceView
                showVoiceView={showVoiceView && (!isCompact || voiceFocused)}
                /* Focusing a stream makes it the big one inside the panel and
                   leaves the app where it was. Hiding the chat is its own press. */
                voiceWidth={voiceWidthFor({ chatTakenOver, voiceWidth, isMaximized, shownVoiceWidth })}
                maxWidth={
                  // Both of these hide the chat, so the width reserved for a
                  // minimum chat column would otherwise cap the panel.
                  isMaximized || chatTakenOver ? undefined : voiceMaxWidth
                }
                serverHost={host}
                currentServerConnected={currentServerConnected}
                currentChannelId={currentChannelId}
                clientsForHost={hostClients}
                members={hostMembers}
                clientsSpeaking={voiceClientsSpeaking}
                isConnecting={isConnecting}
                currentConnectionId={selfClientId}
                isCall={connectedToACall}
                onDisconnect={handleVoiceDisconnect}
                peerLatency={peerLatency}
                onDisconnectUser={canDisconnectFromVoice ? requestDisconnectUser : undefined}
                currentUserRole={currentUserRole}
                adminActions={currentAdminActions}
                videoStreams={voiceVideoStreams}
                streamSources={voiceStreamSources}
                onFocusChange={setVoiceFocused}
                isMaximized={isMaximized}
                onToggleMaximize={toggleMaximized}
                chatHidden={focusedChatHidden}
                onToggleChat={toggleFocusedChat}
              />
              <div style={{
                display: chatPaneHidden ? "none" : "flex",
                flex: 1,
                minWidth: 0,
                ...(isVoiceOnThisServer && isServerUnreachable && { opacity: 0.5, pointerEvents: "none" as const }),
                transition: "opacity 0.3s ease",
              }}>
                {chatView}
              </div>
            </div>
            {sidePanel === "search" && (
              <SearchPanel
                key={searchStartIn?.value ?? "all"}
                startIn={searchStartIn}
                socketConnection={currentConnection}
                serverHost={host}
                serverName={serverName}
                channels={hostChannels}
                memberList={memberListMap}
                focusNonce={searchFocus}
                onClose={() => setSearchOpen(false)}
                onOpen={(channel, hit) => {
                  if (channel.id !== visibleChannelId) handleChannelClickAndCloseDm(channel);
                  setPendingJump({
                    conversationId: channel.id,
                    messageId: hit.thread_root_message_id ?? hit.message_id,
                    nonce: Date.now(),
                  });
                }}
              />
            )}
            {sidePanel === "dm-search" && (
              <SearchPanel
                key={activeDm?.conversation_id ?? "all"}
                socketConnection={null}
                serverHost={host}
                serverName="direct messages"
                channels={dmSearchChannels}
                memberList={memberListMap}
                focusNonce={searchFocus}
                onClose={() => setDmSearchOpen(false)}
                local={{
                  conversations: directory.map((e) => ({ host: e.host, conversationId: e.conversation.conversation_id, title: conversationTitle(e.conversation) })),
                  startIn: activeDm ? { key: "in", value: activeDm.conversation_id, label: conversationTitle(activeDm) } : undefined,
                }}
                onOpen={(_conversation, hit) => {
                  const entry = directory.find((e) => e.conversation.conversation_id === hit.conversation_id);
                  if (!entry) return;
                  if (entry.host === host) {
                    visitConversation(hit.conversation_id);
                    setSelectedDmId(hit.conversation_id);
                  } else {
                    requestConversation(entry.host, hit.conversation_id);
                    viewServerBehindDmSpace(entry.host);
                  }
                  setPendingJump({ conversationId: hit.conversation_id, messageId: hit.message_id, nonce: Date.now() });
                }}
              />
            )}
            {sidePanel === "dm-member" && activeDm && (
              /* Folds like the channel list rather than vanishing. The negative margin takes
                 back the row's gap, so a closed panel leaves no strip. */
              <motion.div
                data-gryt="dm-info-slot"
                animate={{ width: dmInfoOpen ? DM_PANEL_WIDTH : 0, marginLeft: dmInfoOpen ? 0 : -16 }}
                initial={false}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                style={{ flexShrink: 0, overflow: "hidden", display: "flex", justifyContent: "flex-start" }}
                aria-hidden={!dmInfoOpen}
                inert={!dmInfoOpen}
              >
              {activeDm.kind === "group" ? (
                <DmGroupPanel
                  host={host}
                  conversation={activeDm}
                  memberList={memberListMap}
                  onEdit={() => setGroupDialog(activeDm)}
                  onAdd={() => setGroupDialog(activeDm)}
                  onLeave={() => {
                    const group = activeDm;
                    askLeave(conversationTitle(group), () => {
                      setSelectedDmId((current) => (current === group.conversation_id ? null : current));
                      leaveGroup(group.conversation_id);
                    });
                  }}
                />
              ) : (
                <DmPersonPanel
                  host={host}
                  member={memberListMap[activeDm.other.server_user_id]}
                  conversation={activeDm}
                  pins={dmPins}
                  memberList={memberListMap}
                  onJump={(messageId) => setPendingJump({ conversationId: activeDm.conversation_id, messageId, nonce: Date.now() })}
                  onHide={() => {
                    const dm = activeDm;
                    askHide(conversationTitle(dm), () => {
                      hideConversationWithUndo(host, currentServerUserId ?? "", dm.conversation_id, conversationTitle(dm));
                      forgetHiddenDm(dm.conversation_id);
                    });
                  }}
                />
              )}
              </motion.div>
            )}
            {sidePanel === "members" && (
            <MemberSidebarPanel
              // Closed for good, not collapsed: the server stops sending the list,
              // so an open panel would show whatever was last cached.
              sidebarOpen={rightSidebarOpen && canViewMembers && !dmSpace}
              sidebarWidthPx={SIDEBAR_WIDTH_PX}
              hoverPx={SIDEBAR_HOVER_PX}
              contentRef={rightSidebarContentRef}
              isUnreachableWhileConnected={isServerUnreachable}
              onMouseEnter={!canViewMembers ? undefined : openRightSidebar}
              onMouseLeave={closeRightSidebar}
              members={hostMembers}
              currentConnectionId={selfClientId}
              currentServerUserId={currentServerUserId}
              currentUserRole={currentUserRole}
              currentServerConnected={currentServerConnected}
              serverHost={host}
              adminActions={currentAdminActions}
              onOpenDm={requestOpenDm}
              isBlocked={isBlocked}
              onToggleBlock={(targetServerUserId) =>
                (isBlocked(targetServerUserId) ? unblock : blockAndHide)(targetServerUserId)
              }
              onReport={setReportTarget}
            />
            )}
          </div>
        )}
      </div>

      {incomingCall ? (
        <IncomingCallCard
          call={incomingCall}
          title={
            // The conversation's name when known, which for a group is not the one
            // person ringing. A call can arrive before `dm:list` catches up.
            callerTitle(directConversations.find((c) => c.conversation_id === incomingCall.conversation_id), incomingCall.from.nickname)
          }
          avatarUrl={callerAvatarUrl}
          avatarWorn={callerAvatarWorn}
          onAccept={handleAcceptCall}
          onDecline={() => declineCall(incomingCall.conversation_id)}
        />
      ) : null}

      <GroupDialog
        open={groupDialog !== null}
        onOpenChange={(next) => { if (!next) setGroupDialog(null); }}
        members={hostMembers ?? []}
        serverHost={host}
        currentServerUserId={currentServerUserId}
        existing={groupDialog ?? undefined}
        canAdd={viewerPermissions.can("create_groups")}
        onUpdate={updateGroup}
        onAdd={addToGroup}
        onLeave={(id) => {
          setSelectedDmId((current) => (current === id ? null : current));
          leaveGroup(id);
        }}
      />

      <SidebarEditDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} editor={sidebarEditor} />
      <NewFolderDialog
        open={newFolderOpen}
        onOpenChange={setNewFolderOpen}
        onCreate={(name) => void insertFromPalette("folder", effectiveSidebarItems.length, name)}
      />
      <CreateChannelDialog
        open={createChannelOpen}
        onOpenChange={setCreateChannelOpen}
        initialType={createChannelType}
        placement={createChannelPlacement}
        editor={sidebarEditor}
      />

      <ReportUserDialog
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        isBlocked={isBlocked}
        onSubmit={({ serverUserId, reason, alsoBlock }) => {
          reportUser({ serverUserId, reason });
          /* The reporter's own act, so it does not wait on the report landing:
             on a server too old for `user:report` the block still works. */
          if (alsoBlock) blockAndHide(serverUserId);
        }}
      />

      {hideDialog}
      <ConfirmDialog
        open={!!pendingLeave}
        onOpenChange={(open) => {
          if (!open) setPendingLeave(null);
        }}
        title={`Leave ${pendingLeave?.title ?? "this group"}?`}
        description="You stop getting its messages and drop off its member list. Anybody still in it can add you back."
        confirmLabel="Leave group"
        confirmTone="danger"
        onConfirm={() => {
          pendingLeave?.leave();
          setPendingLeave(null);
        }}
      />
      <ServerConfirmDialogs
        pendingDeleteItem={pendingDeleteItem}
        channelById={channelById}
        cancelDelete={cancelDelete}
        confirmDelete={confirmDelete}
        pendingDisconnectUser={pendingDisconnectUser}
        setPendingDisconnectUser={setPendingDisconnectUser}
        onDisconnectUser={handleDisconnectUser}
        pendingKickUser={pendingKickUser}
        setPendingKickUser={setPendingKickUser}
        onKickUser={handleKickUser}
        pendingBanUser={pendingBanUser}
        setPendingBanUser={setPendingBanUser}
        onBanUser={handleBanUser}
        fetchMemberInvite={fetchMemberInvite}
        pendingFolderMove={
          sidebarEditor.pendingFolderMove
            ? {
                channelName: channelById.get(sidebarEditor.pendingFolderMove.channelId)?.name || "channel",
                folderName:
                  effectiveSidebarItems.find((i) => i.id === sidebarEditor.pendingFolderMove?.folderId)?.label ?? null,
              }
            : null
        }
        answerFolderMove={sidebarEditor.answerFolderMove}
      />

      {/* Asked once per conversation per blocking state, not every send. */}
      {/* No onOpenChange: confirmPlaintextSend and cancelPlaintextSend each
          clear the prompt, and putting the cancel in onOpenChange would fire it
          on the way out of a confirm -- sending the message and cancelling it in
          one click. */}
      <ConfirmDialog
        open={!!plaintextPrompt}
        onConfirm={confirmPlaintextSend}
        onCancel={cancelPlaintextSend}
        title="Send this without encryption?"
        description={
          <>
            This conversation cannot be encrypted right now, so whoever runs this
            server will be able to read what you send, in the clear.
            {plaintextPrompt?.kind === "plaintext" && plaintextPrompt.blockedBy.length > 0 && (
              <>
                {" "}
                {plaintextPrompt.blockedBy
                  .map((blocked) => {
                    const who = memberNames[blocked.memberId]
                      ?? "Somebody in this conversation";
                    if (blocked.reason === "changed") return `${who} changed their key`;
                    if (blocked.reason === "unusable") return `${who}'s key did not check out`;
                    return `${who} has not published a key`;
                  })
                  .join(", ")}
                .
              </>
            )}
          </>
        }
        confirmLabel="Send unencrypted"
      />

    </MemberCardActionsContext.Provider>
  );
};
