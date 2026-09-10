import { Button } from "@gryt/ui";
import { useSFU } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { clearMentions, clearSignedOut, getUploadsFileUrl, markChannelRead, useAccount, useMentionTracker, useThreadMentions, useUnreadTracker } from "@/common";
import { useIsCompact, useIsMobile } from "@/mobile";
import { useSettings } from "@/settings";
import { SidebarItem } from "@/settings/src/types/server";

import { useFakeChat } from "../dev/fakeChat";
import { useFakeChatRunning } from "../dev/fakeChatController";
import {
  fakeChatSendersFrom,
  fakeParticipantOptionsFromSettings,
  readFakeParticipantOptions,
  withFakeMembers,
  withFakeParticipants,
} from "../dev/fakeParticipants";
import { readFakeCallOptions, useFakeCallEvents } from "../dev/fakeServerEvents";
import { useFakeSpeech } from "../dev/fakeSpeech";
import { useDirectory } from "../hooks/dmDirectory";
import { conversationFor, conversationOpened, leftOver, rememberConversation, requestConversation, setDmSpaceOpen, usePendingConversation, useVisitingConversation } from "../hooks/dmSpace";
import { useAdminActions } from "../hooks/useAdminActions";
import { useBlocks } from "../hooks/useBlocks";
import { useCalls } from "../hooks/useCalls";
import { useChannelSettings, useHandleChannelClick } from "../hooks/useChannelSettings";
import { useChat } from "../hooks/useChat";
import { conversationTitle, type DirectConversation,useDirectMessages } from "../hooks/useDirectMessages";
import { useLatencyReporting } from "../hooks/useLatencyReporting";
import { useIsTinyWindow, useRoomForMemberList, useRoomForVoicePanel } from "../hooks/useNarrowWindow";
import { usePeerLatency } from "../hooks/usePeerLatency";
import { useServerPermissions } from "../hooks/usePermissions";
import { useReportUser } from "../hooks/useReportUser";
import { useServerManagement } from "../hooks/useServerManagement";
import { useServerReports } from "../hooks/useServerReports";
import { useServerState } from "../hooks/useServerState";
import { SIDEBAR_HOVER_PX, SIDEBAR_WIDTH_PX, useMediaAutoShow, useSidebarHover, useVoiceLayout } from "../hooks/useServerViewLayout";
import { useSidebarEditor } from "../hooks/useSidebarEditor";
import { useSockets } from "../hooks/useSockets";
import { getUpdateAvailable } from "../hooks/useVersionStatus";
import { getCustomEmojis } from "../utils/emojiData";
import { ChatView } from "./ChatView";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConnectionBanner } from "./ConnectionBanner";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { DmSpaceSidebar } from "./DmSpaceSidebar";
import { GroupDialog } from "./GroupDialog";
import { IncomingCallCard } from "./IncomingCallCard";
import { MemberSidebarPanel } from "./MemberSidebarPanel";
import { MobileServerView } from "./MobileServerView";
import { ReportsPanel } from "./ReportsPanel";
import { ReportUserDialog } from "./ReportUserDialog";
import { ServerConfirmDialogs } from "./ServerConfirmDialogs";
import { ServerLoadingStates } from "./ServerLoadingStates";
import { ServerNoticePanel } from "./ServerNoticePanel";
import { ServerSidebar } from "./ServerSidebar";
import { SidebarEditDialog } from "./SidebarEditDialog";
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

/**
 * `dmSpace` swaps the channel sidebar for every server's conversations and drops
 * the member panel. The rest is the same view, keys and all (GRYT-1134).
 */
export const ServerView = ({ dmSpace = false }: { dmSpace?: boolean }) => {
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const isTiny = useIsTinyWindow();
  const {
    showVoiceView, setShowVoiceView, nickname, setShowSettings, setSettingsTab,
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
  const { connect, currentServerConnected, isConnected, isConnecting, videoStreams, streamSources } = useSFU();
  const { serverDetailsList, clients, memberLists, serverProfiles } = useSockets();
  const { login } = useAccount();

  const {
    clientsSpeaking, voiceWidth,
    selectedChannelId, setSelectedChannelId,
    selectedDmId, setSelectedDmId,
    handleVoiceDisconnect, setPendingChannelId, currentChannelId,
    currentConnection, accessToken, serverFailure, hasTimedOut,
    currentConnectionStatus, currentRefusalReason, currentRefusalHelpUrl, reconnectServer,
  } = useServerState();

  const sidebarEditor = useSidebarEditor({ currentlyViewingServer, currentConnection, accessToken, serverDetailsList });
  const {
    editDialogOpen, setEditDialogOpen, setSelectedSidebarItemId,
    effectiveSidebarItems, reorderSidebar, insertFromPalette,
    pendingDeleteItem, requestDeleteSidebarItem, cancelDelete, confirmDelete,
  } = sidebarEditor;

  useLatencyReporting(currentConnection);
  const peerLatency = usePeerLatency(currentConnection);

  const {
    voiceFocused, setVoiceFocused, isMaximized, toggleMaximized,
    voiceContainerRef, voiceMaxWidth, shownVoiceWidth,
  } = useVoiceLayout({ setShowVoiceView });

  const [focusedChatHidden, setFocusedChatHidden] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createChannelType, setCreateChannelType] = useState<"chat" | "voice" | "forum" | "automated">("chat");
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


  const drawnVoicePanelWidth =
    showVoiceView && voiceWidth !== "0px" && !isMaximized && !chatTakenOver
      ? shownVoiceWidth
      : 0;
  const roomForMembers = useRoomForMemberList(drawnVoicePanelWidth);
  const roomForVoice = useRoomForVoicePanel();

  const {
    leftSidebarOpen, rightSidebarOpen,
    leftSidebarContentRef, rightSidebarContentRef,
    openLeftSidebar, closeLeftSidebar, openRightSidebar, closeRightSidebar,
  } = useSidebarHover({ pinChannelsSidebar, pinMembersSidebar, isDraggingResize: false, isCompact, roomForMembers });

  const serverClients = currentlyViewingServer ? clients[currentlyViewingServer.host] : undefined;
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

  const currentServerUserId = currentlyViewingServer && currentConnection?.id
    ? clients[currentlyViewingServer.host]?.[currentConnection.id]?.serverUserId
    : undefined;

  /* Ahead of `useChat`, which needs the members to know whether the next message
     can be encrypted. Both unconditional, so the order is free. */
  const {
    conversations: directConversations,
    openDm,
    setHidden: setDmHidden,
    createGroup,
    updateGroup,
    addToGroup,
    leaveGroup,
  } = useDirectMessages({
    socket: currentConnection,
    accessToken,
    isConnected: currentConnectionStatus === "connected",
  });

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

  const conversationMembers = useMemo(
    () =>
      directConversations.find((c) => c.conversation_id === activeConversationId)
        ?.members ?? null,
    [directConversations, activeConversationId],
  );

  const {
    chatMessages, sealing, canSend, canSendHere, sendChat, editMessage, isLoadingMessages,
    isRateLimited, rateLimitCountdown, isVoiceChannelTextChat,
    canViewVoiceChannelText, activeChannelName, activeChannelType, activeChannelAutomated, activeChannelLayout, activeChannelForumTags,
    restoreText, clearRestoreText, fetchOlderMessages, isLoadingOlder, hasOlderMessages,
    plaintextPrompt, confirmPlaintextSend, cancelPlaintextSend,
  } = useChat({
    currentConnection, activeConversationId, currentlyViewingServer,
    currentChannelId, isConnected, serverDetailsList, nickname,
    currentUserId: currentServerUserId,
    conversationMembers,
  });

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

  const handleAddItem = useCallback((kind: string) => {
    // "Add channel" opens the full create modal instead of dropping a default
    // channel that has to be edited after. Folders/spacers stay immediate. GRYT-983.
    if (kind === "channel:text" || kind === "channel:voice") {
      setCreateChannelType(kind === "channel:voice" ? "voice" : "chat");
      setCreateChannelOpen(true);
      return;
    }
    insertFromPalette(kind, effectiveSidebarItems.length);
  }, [insertFromPalette, effectiveSidebarItems]);

  const viewerPermissions = useServerPermissions(currentlyViewingServer?.host || "");

  const { reportsOpen, setReportsOpen, pendingReportCount, memberListMap } = useServerReports({
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

  /* Nothing asked for and nothing open: open the most recent conversation. An
     empty pane under the space's header reads as a server's channel. */
  const visiting = useVisitingConversation();
  useEffect(() => {
    if (!dmSpace) return;
    const host = currentlyViewingServer?.host;
    if (!host || conversationFor(host)) return;
    // An empty one an earlier visit left selected counts as nothing open. GRYT-1148.
    const selected = selectedDmId
      ? directory.find((entry) => entry.host === host && entry.conversation.conversation_id === selectedDmId)
      : undefined;
    const stale = leftOver(selected?.conversation, visiting);
    if (selectedDmId && !stale) return;
    const recent = directory
      .filter((entry) => entry.conversation.last_message_at !== null)
      .sort((a, b) =>
        (b.conversation.last_message_at ?? "").localeCompare(a.conversation.last_message_at ?? ""))[0];
    if (!recent) {
      if (stale) setSelectedDmId(null);
      return;
    }
    requestConversation(recent.host, recent.conversation.conversation_id);
    if (recent.host !== host) viewServerBehindDmSpace(recent.host);
  }, [dmSpace, selectedDmId, visiting, currentlyViewingServer?.host, directory, viewServerBehindDmSpace, setSelectedDmId]);

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
    setSelectedDmId(call.conversation_id);
    setShowVoiceView(true);
    connect(call.conversation_id).catch((error) => {
      console.error("Could not join the call:", error);
      toast.error(error instanceof Error ? error.message : "Could not join the call");
    });
  }, [acceptCall, connect, setSelectedDmId, setShowVoiceView]);

  const handleSelectDm = useCallback((conversation: { conversation_id: string }) => {
    setSelectedDmId(conversation.conversation_id);
  }, [setSelectedDmId]);

  /* Hiding the one being read points the view at a conversation no longer in the
     list, so the selection goes back to the channels. */
  const handleHideDm = useCallback((conversation: { conversation_id: string }) => {
    setSelectedDmId((current) => (current === conversation.conversation_id ? null : current));
    setDmHidden(conversation.conversation_id, true);
  }, [setDmHidden, setSelectedDmId]);

  /** `null` is closed, a conversation is managing that one, and an array of ids
      is a new group with those people ticked. */
  const [groupDialog, setGroupDialog] = useState<DirectConversation | string[] | null>(null);

  const activeDm = useMemo(
    () => (dmSpace && selectedDmId
      ? directConversations.find((c) => c.conversation_id === selectedDmId)
      : undefined),
    [dmSpace, selectedDmId, directConversations],
  );

  /** A lookup, not a test on the id, since a channel can be named to look like
      one. `currentChannelId` is the room joined, not the one on screen. */
  const connectedToACall = useMemo(
    () => Boolean(currentChannelId)
      && directConversations.some((c) => c.conversation_id === currentChannelId),
    [currentChannelId, directConversations],
  );

  const handleChannelClick = useHandleChannelClick({
    currentlyViewingServer, isConnected, currentServerConnected,
    currentChannelId, selectedChannelId, isConnecting,
    showVoiceView, mediaAutoShownRef,
    setSelectedChannelId, setShowVoiceView, setPendingChannelId,
    setSettingsTab, setShowSettings, setLastSelectedChannelForServer,
    connect, applyChannelSettings, setIsMuted, setIsDeafened,
  });

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

  /** Built once for both layouts. Calling is offered whether or not one is
      going, and `start_calls` is not the permission for answering. */
  const dmHeaderActions = useMemo(() => {
    if (!activeDm || !viewerPermissions.can("send_direct_messages")) return undefined;
    const conversationId = activeDm.conversation_id;
    const ringing = outgoingCall?.conversation_id === conversationId;
    const mayCall = viewerPermissions.can("start_calls");

    /** The caller is in the room from the moment it rings, or answering joins a
        room with nobody in it. Cancel is offered until somebody answers. */
    const startCall = () => {
      ringConversation(conversationId);
      setShowVoiceView(true);
      connect(conversationId).catch((error) => {
        console.error("Could not start the call:", error);
        toast.error(error instanceof Error ? error.message : "Could not start the call");
        cancelCall(conversationId);
      });
    };

    const stopCall = () => {
      cancelCall(conversationId);
      handleVoiceDisconnect();
    };

    return (
      <div className="flex items-center gap-1">
        {mayCall ? (
          <Button
            size="small"
            tone={ringing ? "primary" : "ghost"}
            onClick={() => (ringing ? stopCall() : startCall())}
          >
            {ringing ? "Cancel" : "Call"}
          </Button>
        ) : null}
        {activeDm.kind === "dm" ? (
          <Button size="small" tone="ghost" onClick={() => setGroupDialog([activeDm.other.server_user_id])}>
            New group
          </Button>
        ) : null}
      </div>
    );
  }, [activeDm, viewerPermissions, outgoingCall, cancelCall, ringConversation, setGroupDialog, connect, setShowVoiceView, handleVoiceDisconnect]);

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

  if (!currentlyViewingServer) return null;

  const serverDetails = serverDetailsList[currentlyViewingServer.host];
  const serverNickname = serverProfiles[currentlyViewingServer.host]?.nickname || nickname;
  const channelById = new Map((serverDetails?.channels || []).map((c) => [c.id, c]));

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
      clients[host] || {},
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

  /** One element for two layouts: the tiny window renders this and nothing else,
      and a second copy is thirty props to keep in step. */
  const chatView = dmSpace && !activeDm ? (
    /* The space with nothing open, for the moment before the most recent one is
       picked or when there are none. A bare ChatView here was read as a channel. */
    <div
      className="flex grow items-center justify-center text-sm"
      style={{ color: "var(--gryt-muted)", padding: "2rem", textAlign: "center" }}
    >
      {directory.some((entry) => entry.conversation.last_message_at !== null)
        ? "Choose a conversation."
        : "No conversations yet. Click somebody in a server\u2019s member list to start one."}
    </div>
  ) : (
      <ChatView
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
        memberNames={memberNames}
        canSend={canSend}
        canSendHere={canSendHere}
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
        canDeleteAny={viewerPermissions.can("manage_messages")}
        maxFileSize={serverDetails.server_info?.upload_max_bytes}
        onLoadOlder={fetchOlderMessages}
        isLoadingOlder={isLoadingOlder}
        hasOlderMessages={hasOlderMessages}
        {...(isLoadingMessages !== undefined && { isLoadingMessages })}
      />
  );

  return (
    <>
      <div className="flex w-full h-full gap-4 flex-col" data-gryt="server-view">
        {isServerUnreachable && (
          <ConnectionBanner connectionStatus={currentConnectionStatus} onReconnect={() => reconnectServer(host)} />
        )}
        {isTiny ? (
          /* One channel and no way to change it; the way out is a bigger window.
             A call is the exception, or the microphone has no button to close it. */
          <div className="flex" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            {chatView}
            <VoiceSheetButton
              connected={isVoiceOnThisServer}
              serverHost={host}
              currentServerConnected={currentServerConnected}
              currentChannelId={currentChannelId}
              clientsForHost={hostClients}
              members={hostMembers}
              clientsSpeaking={voiceClientsSpeaking}
              isConnecting={isConnecting}
              currentConnectionId={currentConnection?.id}
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
        ) : isMobile ? (
          <MobileServerView
            dmSpace={dmSpace}
            onOpenDm={requestOpenDm}
            serverName={serverName}
            serverRole={currentUserRole}
            isServerUnreachable={isServerUnreachable}
            isConnectedToVoiceOnThisServer={isVoiceOnThisServer}
            onOpenSettings={onOpenSettings}
            onOpenInvites={onOpenInvites}
            onOpenReports={() => setReportsOpen(true)}
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
            currentConnectionId={currentConnection?.id}
            selectedChannelId={visibleChannelId}
            onChannelClick={handleChannelClickAndCloseDm}
            directConversations={directConversations}
            selectedDmId={visibleDmId}
            onSelectDm={handleSelectDm}
            onHideDm={handleHideDm}
            onManageGroup={setGroupDialog}
            clientsSpeaking={voiceClientsSpeaking}
            canManage={canManage}
            onEditItem={handleEditItem}
            onDeleteItem={requestDeleteSidebarItem}
            onMoveItem={handleMoveItem}
            onReorder={reorderSidebar}
            onAddItem={handleAddItem}
            onDisconnectUser={canDisconnectFromVoice ? requestDisconnectUser : undefined}
            currentUserRole={currentUserRole}
            adminActions={currentAdminActions}
            unreadCounts={unreadCounts}
            mentionCounts={mentionCounts}
            chatMessages={visibleChatMessages}
            sealing={activeDm ? sealing : undefined}
            memberNames={memberNames}
            canSend={canSend}
            canSendHere={canSendHere}
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
            canDeleteAny={viewerPermissions.can("manage_messages")}
            maxFileSize={serverDetails.server_info?.upload_max_bytes}
            onLoadOlder={fetchOlderMessages}
            isLoadingOlder={isLoadingOlder}
            hasOlderMessages={hasOlderMessages}
            voiceWidth={voiceWidth}
            clientsForHost={hostClients}
            isCall={connectedToACall}
            onVoiceDisconnect={handleVoiceDisconnect}
            peerLatency={peerLatency}
            videoStreams={voiceVideoStreams}
            streamSources={voiceStreamSources}
          />
        ) : (
          <div className="flex w-full gap-4" style={{
              flex: 1, overflow: "hidden",
              ...(isServerUnreachable && !isVoiceOnThisServer && { opacity: 0.5, pointerEvents: "none" as const }),
              transition: "opacity 0.3s ease",
            }}>
            {dmSpace ? (
              <DmSpaceSidebar
                host={host}
                selectedConversationId={visibleDmId}
                onOpen={handleSelectDm}
              />
            ) : (
            <ServerSidebar
              sidebarOpen={leftSidebarOpen}
              sidebarWidthPx={SIDEBAR_WIDTH_PX}
              hoverPx={SIDEBAR_HOVER_PX}
              contentRef={leftSidebarContentRef}
              isUnreachableWhileConnected={isVoiceOnThisServer && isServerUnreachable}
              onMouseEnter={openLeftSidebar}
              onMouseLeave={closeLeftSidebar}
              serverName={serverName}
              serverRole={currentUserRole}
              pinned={pinChannelsSidebar}
              onTogglePinned={() => setPinChannelsSidebar(!pinChannelsSidebar)}
              onOpenSettings={onOpenSettings}
              onOpenInvites={onOpenInvites}
              onOpenReports={() => setReportsOpen(true)}
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
              currentConnectionId={currentConnection?.id}
              selectedChannelId={visibleChannelId}
              onChannelClick={handleChannelClickAndCloseDm}
            directConversations={directConversations}
            selectedDmId={visibleDmId}
            onSelectDm={handleSelectDm}
            onHideDm={handleHideDm}
            onManageGroup={setGroupDialog}
              clientsSpeaking={voiceClientsSpeaking}
              canManage={canManage}
              onEditItem={handleEditItem}
              onDeleteItem={requestDeleteSidebarItem}
              onMoveItem={handleMoveItem}
              onReorder={reorderSidebar}
              onAddItem={handleAddItem}
              onDisconnectUser={canDisconnectFromVoice ? requestDisconnectUser : undefined}
              currentUserRole={currentUserRole}
              adminActions={currentAdminActions}
              unreadCounts={unreadCounts}
              mentionCounts={mentionCounts}
              streamSources={voiceStreamSources}
            />
            )}
            <div className="flex grow" ref={voiceContainerRef} style={{ position: "relative", minWidth: 0 }}>
              <VoiceView
                showVoiceView={showVoiceView && (!isCompact || voiceFocused)}
                /* Focusing a stream makes it the big one inside the panel and
                   leaves the app where it was. Hiding the chat is its own press. */
                voiceWidth={
                  chatTakenOver
                    ? "100%"
                    : voiceWidth === "0px"
                      ? "0px"
                      : isMaximized
                        ? "100%"
                        : `${shownVoiceWidth}px`
                }
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
                currentConnectionId={currentConnection?.id}
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
            <MemberSidebarPanel
              // Closed for good, not collapsed: the server stops sending the list,
              // so an open panel would show whatever was last cached.
              sidebarOpen={rightSidebarOpen && canViewMembers && !dmSpace}
              sidebarWidthPx={SIDEBAR_WIDTH_PX}
              hoverPx={SIDEBAR_HOVER_PX}
              contentRef={rightSidebarContentRef}
              isUnreachableWhileConnected={isVoiceOnThisServer && isServerUnreachable}
              onMouseEnter={!canViewMembers ? undefined : openRightSidebar}
              onMouseLeave={closeRightSidebar}
              members={hostMembers}
              currentConnectionId={currentConnection?.id}
              currentServerUserId={currentServerUserId}
              currentUserRole={currentUserRole}
              currentServerConnected={currentServerConnected}
              serverHost={host}
              adminActions={currentAdminActions}
              onOpenDm={requestOpenDm}
              isBlocked={isBlocked}
              onToggleBlock={(targetServerUserId) =>
                (isBlocked(targetServerUserId) ? unblock : block)(targetServerUserId)
              }
              onReport={setReportTarget}
              pinned={pinMembersSidebar}
              onTogglePinned={() => setPinMembersSidebar(!pinMembersSidebar)}
            />
          </div>
        )}
      </div>

      {incomingCall ? (
        <IncomingCallCard
          call={incomingCall}
          title={
            // The conversation's name when known, which for a group is not the one
            // person ringing. A call can arrive before `dm:list` catches up.
            directConversations.find((c) => c.conversation_id === incomingCall.conversation_id)
              ? conversationTitle(
                  directConversations.find((c) => c.conversation_id === incomingCall.conversation_id)!,
                )
              : incomingCall.from.nickname
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
        existing={Array.isArray(groupDialog) ? undefined : (groupDialog ?? undefined)}
        initialMemberIds={Array.isArray(groupDialog) ? groupDialog : []}
        onCreate={createGroup}
        onUpdate={updateGroup}
        onAdd={addToGroup}
        onLeave={(id) => {
          setSelectedDmId((current) => (current === id ? null : current));
          leaveGroup(id);
        }}
      />

      <SidebarEditDialog open={editDialogOpen} onOpenChange={setEditDialogOpen} editor={sidebarEditor} />
      <CreateChannelDialog open={createChannelOpen} onOpenChange={setCreateChannelOpen} initialType={createChannelType} editor={sidebarEditor} />

      <ReportUserDialog
        target={reportTarget}
        onClose={() => setReportTarget(null)}
        isBlocked={isBlocked}
        onSubmit={({ serverUserId, reason, alsoBlock }) => {
          reportUser({ serverUserId, reason });
          /* The reporter's own act, so it does not wait on the report landing:
             on a server too old for `user:report` the block still works. */
          if (alsoBlock) block(serverUserId);
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
      />

      <ReportsPanel
        isOpen={reportsOpen}
        onClose={() => setReportsOpen(false)}
        socket={currentConnection}
        serverHost={host}
        memberList={memberLists[host]}
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

    </>
  );
};
