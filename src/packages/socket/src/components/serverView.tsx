import { Button } from "@gryt/ui";
import { useSFU } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getUploadsFileUrl, useAccount, useUnreadTracker } from "@/common";
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
import { useAdminActions } from "../hooks/useAdminActions";
import { useCalls } from "../hooks/useCalls";
import { useChannelSettings, useHandleChannelClick } from "../hooks/useChannelSettings";
import { useChat } from "../hooks/useChat";
import { conversationTitle, type DirectConversation,useDirectMessages } from "../hooks/useDirectMessages";
import { useLatencyReporting } from "../hooks/useLatencyReporting";
import { useIsTinyWindow, useRoomForMemberList, useRoomForVoicePanel } from "../hooks/useNarrowWindow";
import { usePeerLatency } from "../hooks/usePeerLatency";
import { useServerPermissions } from "../hooks/usePermissions";
import { useServerManagement } from "../hooks/useServerManagement";
import { useServerReports } from "../hooks/useServerReports";
import { useServerState } from "../hooks/useServerState";
import { SIDEBAR_HOVER_PX, SIDEBAR_WIDTH_PX, useMediaAutoShow, useSidebarHover, useVoiceLayout } from "../hooks/useServerViewLayout";
import { useSidebarEditor } from "../hooks/useSidebarEditor";
import { useSockets } from "../hooks/useSockets";
import { getUpdateAvailable } from "../hooks/useVersionStatus";
import { getCustomEmojis } from "../utils/emojiData";
import { ChatView } from "./ChatView";
import { ConnectionBanner } from "./ConnectionBanner";
import { GroupDialog } from "./GroupDialog";
import { IncomingCallCard } from "./IncomingCallCard";
import { MemberSidebarPanel } from "./MemberSidebarPanel";
import { MobileServerView } from "./MobileServerView";
import { ReportsPanel } from "./ReportsPanel";
import { ServerConfirmDialogs } from "./ServerConfirmDialogs";
import { ServerLoadingStates } from "./ServerLoadingStates";
import { ServerSidebar } from "./ServerSidebar";
import { SidebarEditDialog } from "./SidebarEditDialog";
import { VoiceSheetButton } from "./VoiceSheetButton";
import { VoiceView } from "./VoiceView";

// Parsed once at module load. The query string overrides the Developer panel
// while it is present, which keeps the browser workflow working.
const fakeParticipantOptionsFromUrl = readFakeParticipantOptions(
  window.location.search,
);

/**
 * The call fixtures, which start before the socket handler rather than after
 * it. `?fakering=1` rings the open conversation; `?fakepeer=1` puts somebody
 * in the call; `?fakepeer=1&fakecallmembers=0` reproduces the bug where a call
 * drew nobody. See `dev/fakeServerEvents.ts`.
 */
const fakeCallOptionsFromUrl = readFakeCallOptions(window.location.search);

export const ServerView = () => {
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
  const { currentlyViewingServer, setShowRemoveServer, setLastSelectedChannelForServer } = useServerManagement();
  const { connect, currentServerConnected, isConnected, isConnecting, videoStreams, streamSources } = useSFU();
  const { serverDetailsList, clients, memberLists, serverProfiles } = useSockets();
  const { login } = useAccount();

  const {
    clientsSpeaking, voiceWidth,
    selectedChannelId, setSelectedChannelId,
    selectedDmId, setSelectedDmId,
    handleVoiceDisconnect, setPendingChannelId, currentChannelId,
    currentConnection, accessToken, activeConversationId, serverFailure, hasTimedOut,
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
  const toggleFocusedChat = useCallback(() => setFocusedChatHidden((v) => !v), []);

  /**
   * The chat is out of the way because somebody put it out of the way.
   *
   * The button lives on the focused view's control row, so this only means
   * anything while a stream is focused — but it is a press either way, which
   * is the whole difference between this and what focus used to do on its own.
   */
  const chatTakenOver = voiceFocused && focusedChatHidden;

  /*
   * What the voice panel is actually taking out of the row, which is what the
   * member list has to be measured against.
   *
   * Zero in three cases, and all three matter: no call, the panel minimized,
   * and the panel maximized — the last one hides the chat entirely, so the
   * member list is not competing with anything.
   */
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
    handleServerMuteUser, handleServerDeafenUser, handleChangeRole,
    requestDisconnectUser, requestKickUser, requestBanUser,
  } = useAdminActions({ currentConnection, currentlyViewingServer, accessToken, memberLists });

  const { getUnreadChannels } = useUnreadTracker();

  const currentServerUserId = currentlyViewingServer && currentConnection?.id
    ? clients[currentlyViewingServer.host]?.[currentConnection.id]?.serverUserId
    : undefined;

  const {
    chatMessages, canSend, sendChat, editMessage, isLoadingMessages,
    isRateLimited, rateLimitCountdown, isVoiceChannelTextChat,
    canViewVoiceChannelText, activeChannelName, activeChannelType,
    restoreText, clearRestoreText, fetchOlderMessages, isLoadingOlder, hasOlderMessages,
  } = useChat({
    currentConnection, activeConversationId, currentlyViewingServer,
    currentChannelId, isConnected, serverDetailsList, nickname,
    currentUserId: currentServerUserId,
  });

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
    insertFromPalette(kind, effectiveSidebarItems.length);
  }, [insertFromPalette, effectiveSidebarItems]);

  const viewerPermissions = useServerPermissions(currentlyViewingServer?.host || "");

  const { reportsOpen, setReportsOpen, pendingReportCount, memberListMap } = useServerReports({
    currentConnection, accessToken, currentlyViewingServer, memberLists,
    canHandleReports: viewerPermissions.can("manage_reports"),
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

  /**
   * Open a DM and read it.
   *
   * The server answers `dm:opened` whether it made one or found the existing
   * one, so this waits for that rather than guessing the id — the id is
   * derivable, but deriving it here would mean the client owning a rule the
   * server also owns, and the two drifting is a bug nobody would see until a
   * conversation opened empty.
   */
  const handleOpenDm = useCallback((targetServerUserId: string) => {
    const existing = directConversations.find(
      (c) => c.other.server_user_id === targetServerUserId,
    );
    if (existing) {
      setSelectedDmId(existing.conversation_id);
      return;
    }
    openDm(targetServerUserId);
  }, [directConversations, openDm, setSelectedDmId]);

  // A conversation opened from the member list is one somebody asked for, so it
  // is opened for reading too. One that arrives because the other person
  // started it is not — that would yank the view out from under them.
  const pendingDmTargetRef = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingDmTargetRef.current;
    if (!target) return;
    const match = directConversations.find((c) => c.other.server_user_id === target);
    if (!match) return;
    pendingDmTargetRef.current = null;
    setSelectedDmId(match.conversation_id);
  }, [directConversations, setSelectedDmId]);

  const requestOpenDm = useCallback((targetServerUserId: string) => {
    pendingDmTargetRef.current = targetServerUserId;
    handleOpenDm(targetServerUserId);
  }, [handleOpenDm]);

  /**
   * Take a call.
   *
   * Answering is joining the conversation's voice room, and nothing else — the
   * server ends the ring when the join lands rather than on a message of its
   * own. `connect` takes the room id opaquely, so a conversation id goes
   * through the same path a channel does.
   *
   * The conversation is opened for reading too. Somebody who just answered is
   * looking at that conversation whatever else was on screen.
   */
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

  /* Hiding the one you are reading leaves the view pointing at a conversation
     that is no longer in the list, so the selection goes back to the channels.
     The conversation is still readable — re-open it from the member list — but
     staying in it would be a screen with no way back to itself. */
  const handleHideDm = useCallback((conversation: { conversation_id: string }) => {
    setSelectedDmId((current) => (current === conversation.conversation_id ? null : current));
    setDmHidden(conversation.conversation_id, true);
  }, [setDmHidden, setSelectedDmId]);

  // The conversation being read, when it is a DM rather than a channel. The
  // chat header and the empty state both need the other person's name, and
  // `useChat` only knows how to look up channels.
  /**
   * The group dialog, and what it is for.
   *
   * `null` is closed. A conversation means managing that one; an array of
   * ids means starting a new group with those people ticked — which is how
   * the button on a direct message hands over who you were talking to.
   */
  const [groupDialog, setGroupDialog] = useState<DirectConversation | string[] | null>(null);

  const activeDm = useMemo(
    () => (selectedDmId
      ? directConversations.find((c) => c.conversation_id === selectedDmId)
      : undefined),
    [selectedDmId, directConversations],
  );

  /**
   * Whether the room this client is connected to is a call rather than a
   * channel — which decides whether being the only one in it ends it
   * (GRYT-711).
   *
   * A lookup in the conversation list, not a test on the id. Both are `dm_`
   * and a hash, and `conversations.ts` says outright that a channel can be
   * named to look like one; the list is the answer rather than an
   * approximation of it. It is also the list this client is already holding.
   *
   * `currentChannelId` is the room actually joined, not the one on screen, so
   * this stays right while somebody reads a channel during a call.
   */
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

  // Picking a channel closes whatever DM was open. Without this the DM would
  // stay the active conversation and the channel would look selected while
  // showing somebody else's messages.
  const handleChannelClickAndCloseDm = useCallback((channel: Parameters<typeof handleChannelClick>[0]) => {
    setSelectedDmId(null);
    handleChannelClick(channel);
  }, [handleChannelClick, setSelectedDmId]);

  /**
   * The caller's picture, from the member list.
   *
   * A ring carries a nickname and nothing else, deliberately — the member list
   * is where a person's appearance lives and duplicating it into the ring would
   * be a second copy to go stale. A caller who is not in the list draws their
   * owl from the nickname, which is what `resolveAvatarSrc` does anyway.
   */
  const caller = incomingCall ? memberListMap[incomingCall.from.server_user_id] : undefined;
  const callerAvatarUrl =
    caller?.avatarFileId && viewingHost
      ? getUploadsFileUrl(viewingHost, caller.avatarFileId, { thumb: true })
      : undefined;
  const callerAvatarWorn = caller?.avatarWorn ?? null;

  /**
   * What sits in the conversation header: call, and start a group.
   *
   * Built once and used by both layouts. The two used to carry a copy of the
   * same button each, which is how one of them ends up a version behind.
   *
   * Calling is offered whether or not a call is already going. Joining one in
   * progress and starting one are the same act — the room is the room — and the
   * server refuses a second ring while the first is going, so pressing it
   * during a ring says so rather than doing something surprising.
   *
   * Offered at all only with `start_calls` (GRYT-712), which a server owner can
   * take off a role to say who may place a call. It is not the permission for
   * answering one — that is `join_voice` — so somebody without this still gets
   * rung and can still pick up. The button is what goes.
   *
   * `can` reads a permission its server has never heard of as held rather than
   * withheld, so this does not take the button away on a server older than the
   * permission.
   */
  const dmHeaderActions = useMemo(() => {
    if (!activeDm || !viewerPermissions.can("send_direct_messages")) return undefined;
    const conversationId = activeDm.conversation_id;
    const ringing = outgoingCall?.conversation_id === conversationId;
    const mayCall = viewerPermissions.can("start_calls");

    /**
     * Ringing and joining are one act.
     *
     * The caller is in the room from the moment it rings. Without that,
     * answering joins a room with nobody in it — the ring says somebody wants
     * to talk to you, you say yes, and there is silence, because the person who
     * rang never went in.
     *
     * Giving up leaves it again. Cancel is only offered while nobody has
     * answered, so at that point the room holds the caller and no one else.
     */
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
    // One handler per permission, rather than one bundle per role name. This
    // used to ask whether somebody was owner, admin or mod and hand over
    // everything or nothing — so a role built to do exactly one of these got a
    // context menu with none of them, whatever its permissions said. Passing a
    // handler as undefined rather than relying on the menu alone means there is
    // no way to reach an action the server would refuse.
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
      onChangeRole: can("manage_roles") ? handleChangeRole : undefined,
    };
  }, [viewerPermissions, requestDisconnectUser, requestKickUser, requestBanUser, handleServerMuteUser, handleServerDeafenUser, handleChangeRole]);

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

  // Dev only. The senders are the same invented people the voice fixture uses,
  // so a message and a tile belong to one person rather than two sets of
  // strangers. See fakeChat.ts.
  const fakeChatRunning = useFakeChatRunning();
  const fakeChatSenders = useMemo(
    () => fakeChatSendersFrom(fakeParticipantOptions),
    [fakeParticipantOptions],
  );

  /* All of them, not just the first. The fixture reacts with these and sends
     them on their own, and one emoji used for everything looks like a stuck
     key rather than like a server with its own emoji. */
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
      />
    );
  }

  const host = currentlyViewingServer.host;
  const unreadChannelIds = getUnreadChannels(host);
  const isServerUnreachable = currentConnectionStatus === "disconnected" || currentConnectionStatus === "reconnecting";
  const isVoiceOnThisServer = isConnected && currentServerConnected === host;
  const currentUserRole = serverDetails?.server_info?.role;
  // Two different questions that used to be one. Editing the sidebar is
  // `manage_channels`; pulling somebody out of voice is voice moderation. A
  // role built to do one and not the other could not say so before.
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

  /**
   * The conversation, as one element used by two layouts.
   *
   * The tiny window renders this and nothing else, and it has to be the same
   * chat with the same thirty props — a second copy is a second copy to keep in
   * step, and the mobile layout already shows what that costs.
   */
  const chatView = (
      <ChatView
        chatMessages={chatMessages}
        conversationKey={activeConversationId}
        canSend={canSend}
        sendChat={sendChat}
        editMessage={editMessage}
        currentUserId={currentServerUserId}
        channelName={activeDm ? conversationTitle(activeDm) : activeChannelName}
        channelType={activeChannelType}
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
          /*
           * One channel, and nothing else.
           *
           * No rail, no channel list, no member list, no voice panel and no
           * page padding — `MainApp` drops those when the window is this size.
           * What is left is the conversation you were already in, filling the
           * window.
           *
           * There is deliberately no way to change channel from here. The way
           * out is to make the window bigger, which is also the only gesture
           * that makes sense for a window somebody shrank on purpose to watch
           * one channel. `useIsTinyWindow` is gated on a fine pointer so a
           * phone never reaches this, where that would be a dead end.
           *
           * A call is the one thing that does not wait for a bigger window.
           * The voice panel is gone at this width, so the floating button the
           * phone layout already uses comes with it — otherwise the microphone
           * stays open with nothing on screen to close it.
           */
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
            serverName={serverName}
            serverRole={currentUserRole}
            isServerUnreachable={isServerUnreachable}
            isConnectedToVoiceOnThisServer={isVoiceOnThisServer}
            onOpenSettings={onOpenSettings}
            onOpenReports={() => setReportsOpen(true)}
            pendingReportCount={pendingReportCount}
            updateAvailable={updateAvailable}
            onLeave={() => setShowRemoveServer(host)}
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
            selectedChannelId={selectedChannelId}
            onChannelClick={handleChannelClickAndCloseDm}
            directConversations={directConversations}
            selectedDmId={selectedDmId}
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
            unreadChannelIds={unreadChannelIds}
            chatMessages={chatMessages}
            canSend={canSend}
            sendChat={sendChat}
            editMessage={editMessage}
            currentUserId={currentServerUserId}
            channelName={activeDm ? conversationTitle(activeDm) : activeChannelName}
            channelType={activeChannelType}
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
              onOpenReports={() => setReportsOpen(true)}
              pendingReportCount={pendingReportCount}
              updateAvailable={updateAvailable}
              onLeave={() => setShowRemoveServer(host)}
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
              selectedChannelId={selectedChannelId}
              onChannelClick={handleChannelClickAndCloseDm}
            directConversations={directConversations}
            selectedDmId={selectedDmId}
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
              unreadChannelIds={unreadChannelIds}
              streamSources={voiceStreamSources}
            />
            <div className="flex grow" ref={voiceContainerRef} style={{ position: "relative", minWidth: 0 }}>
              <VoiceView
                showVoiceView={showVoiceView && (!isCompact || voiceFocused)}
                /* Focusing a stream no longer changes this.
                 *
                 * It used to: focus expanded the panel to two thirds of the
                 * row, shrank the chat to the other third and closed both
                 * sidebars — which is not what focus means, and is why
                 * clicking a tile was described as going fullscreen. Clicking
                 * a tile now makes that stream the big one inside the panel
                 * and leaves the app where it was (GRYT-110).
                 *
                 * Hiding the chat is still a thing you can do, from the button
                 * next to the focused view's controls. That one is a press
                 * rather than a side effect. */
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
                display: chatTakenOver || (isMaximized && showVoiceView && voiceWidth !== "0px") ? "none" : "flex",
                flex: 1,
                minWidth: 0,
                ...(isVoiceOnThisServer && isServerUnreachable && { opacity: 0.5, pointerEvents: "none" as const }),
                transition: "opacity 0.3s ease",
              }}>
                {chatView}
              </div>
            </div>
            <MemberSidebarPanel
              // Closed for good, not just collapsed, when the role may not see
              // who is here. The server stops sending the list as well, so an
              // open panel would show whatever was last cached.
              sidebarOpen={rightSidebarOpen && canViewMembers}
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
            // The conversation's own name when it is known, which for a group
            // is the group rather than the one person ringing. Falls back to
            // the caller: a call can arrive before `dm:list` has caught up with
            // a conversation that was only just made.
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
    </>
  );
};
