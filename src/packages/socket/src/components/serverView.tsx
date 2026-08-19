import { useSFU } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useUnreadTracker } from "@/common";
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
import { useFakeSpeech } from "../dev/fakeSpeech";
import { useAdminActions } from "../hooks/useAdminActions";
import { useChannelSettings, useHandleChannelClick } from "../hooks/useChannelSettings";
import { useChat } from "../hooks/useChat";
import { useLatencyReporting } from "../hooks/useLatencyReporting";
import { usePeerLatency } from "../hooks/usePeerLatency";
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
import { MemberSidebarPanel } from "./MemberSidebarPanel";
import { MobileServerView } from "./MobileServerView";
import { ReportsPanel } from "./ReportsPanel";
import { ServerConfirmDialogs } from "./ServerConfirmDialogs";
import { ServerLoadingStates } from "./ServerLoadingStates";
import { ServerSidebar } from "./ServerSidebar";
import { SidebarEditDialog } from "./SidebarEditDialog";
import { VoiceView } from "./VoiceView";

// Parsed once at module load. The query string overrides the Developer panel
// while it is present, which keeps the browser workflow working.
const fakeParticipantOptionsFromUrl = readFakeParticipantOptions(
  window.location.search,
);

export const ServerView = () => {
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
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

  const {
    clientsSpeaking, voiceWidth,
    selectedChannelId, setSelectedChannelId,
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
    focusedChatWidth, focusedVoiceMaxWidth,
  } = useVoiceLayout({ setShowVoiceView });

  const [focusedChatHidden, setFocusedChatHidden] = useState(false);
  const toggleFocusedChat = useCallback(() => setFocusedChatHidden((v) => !v), []);

  const {
    leftSidebarOpen, rightSidebarOpen,
    leftSidebarContentRef, rightSidebarContentRef,
    openLeftSidebar, closeLeftSidebar, openRightSidebar, closeRightSidebar,
  } = useSidebarHover({ pinChannelsSidebar, pinMembersSidebar, isDraggingResize: false, isCompact });

  const serverClients = currentlyViewingServer ? clients[currentlyViewingServer.host] : undefined;
  const { mediaAutoShownRef } = useMediaAutoShow({
    showVoiceView, setShowVoiceView, isCompact, isConnected,
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

  const currentRole = currentlyViewingServer
    ? serverDetailsList[currentlyViewingServer.host]?.server_info?.role
    : undefined;

  const { reportsOpen, setReportsOpen, pendingReportCount, memberListMap } = useServerReports({
    currentConnection, accessToken, currentlyViewingServer, memberLists, serverRole: currentRole,
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

  const handleChannelClick = useHandleChannelClick({
    currentlyViewingServer, isConnected, currentServerConnected,
    currentChannelId, selectedChannelId, isConnecting,
    showVoiceView, mediaAutoShownRef,
    setSelectedChannelId, setShowVoiceView, setPendingChannelId,
    setSettingsTab, setShowSettings, setLastSelectedChannelForServer,
    connect, applyChannelSettings, setIsMuted, setIsDeafened,
  });

  const currentAdminActions = useMemo(() => {
    // Mods get the reversible actions; ban stays with admin and owner, and the
    // menu applies the same two floors per item. Passing onBanUser as undefined
    // rather than relying on the menu alone means a mod has no handler for it
    // at all, not just no button.
    const canModerate =
      currentRole === "owner" || currentRole === "admin" || currentRole === "mod";
    if (!canModerate) return undefined;

    const canBan = currentRole === "owner" || currentRole === "admin";
    return {
      onDisconnectUser: requestDisconnectUser,
      onKickUser: requestKickUser,
      onBanUser: canBan ? requestBanUser : undefined,
      onServerMuteUser: handleServerMuteUser,
      onServerDeafenUser: handleServerDeafenUser,
      onChangeRole: currentRole === "owner" ? handleChangeRole : undefined,
    };
  }, [currentRole, requestDisconnectUser, requestKickUser, requestBanUser, handleServerMuteUser, handleServerDeafenUser, handleChangeRole]);

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
  useFakeChat({
    running: fakeChatRunning,
    connection: currentConnection,
    conversationId: activeConversationId,
    senders: fakeChatSenders,
    selfNickname: nickname,
    emojiName: getCustomEmojis()[0]?.name ?? null,
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
      />
    );
  }

  const host = currentlyViewingServer.host;
  const unreadChannelIds = getUnreadChannels(host);
  const isServerUnreachable = currentConnectionStatus === "disconnected" || currentConnectionStatus === "reconnecting";
  const isVoiceOnThisServer = isConnected && currentServerConnected === host;
  const currentUserRole = serverDetails?.server_info?.role;
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";
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

  return (
    <>
      <div className="flex w-full h-full gap-4 flex-col" data-gryt="server-view">
        {isServerUnreachable && (
          <ConnectionBanner connectionStatus={currentConnectionStatus} onReconnect={() => reconnectServer(host)} />
        )}
        {isMobile ? (
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
            onChannelClick={handleChannelClick}
            clientsSpeaking={voiceClientsSpeaking}
            canManage={canManage}
            onEditItem={handleEditItem}
            onDeleteItem={requestDeleteSidebarItem}
            onMoveItem={handleMoveItem}
            onReorder={reorderSidebar}
            onAddItem={handleAddItem}
            onDisconnectUser={canManage ? requestDisconnectUser : undefined}
            currentUserRole={currentUserRole}
            adminActions={currentAdminActions}
            unreadChannelIds={unreadChannelIds}
            chatMessages={chatMessages}
            canSend={canSend}
            sendChat={sendChat}
            editMessage={editMessage}
            currentUserId={currentServerUserId}
            channelName={activeChannelName}
            channelType={activeChannelType}
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
            canDeleteAny={currentUserRole === "owner"}
            maxFileSize={serverDetails.server_info?.upload_max_bytes}
            onLoadOlder={fetchOlderMessages}
            isLoadingOlder={isLoadingOlder}
            hasOlderMessages={hasOlderMessages}
            voiceWidth={voiceWidth}
            clientsForHost={hostClients}
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
              sidebarOpen={leftSidebarOpen && !voiceFocused}
              sidebarWidthPx={SIDEBAR_WIDTH_PX}
              hoverPx={SIDEBAR_HOVER_PX}
              contentRef={leftSidebarContentRef}
              isUnreachableWhileConnected={isVoiceOnThisServer && isServerUnreachable}
              onMouseEnter={voiceFocused ? undefined : openLeftSidebar}
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
              onChannelClick={handleChannelClick}
              clientsSpeaking={voiceClientsSpeaking}
              canManage={canManage}
              onEditItem={handleEditItem}
              onDeleteItem={requestDeleteSidebarItem}
              onMoveItem={handleMoveItem}
              onReorder={reorderSidebar}
              onAddItem={handleAddItem}
              onDisconnectUser={canManage ? requestDisconnectUser : undefined}
              currentUserRole={currentUserRole}
              adminActions={currentAdminActions}
              unreadChannelIds={unreadChannelIds}
              streamSources={voiceStreamSources}
            />
            <div className="flex grow" ref={voiceContainerRef} style={{ position: "relative", minWidth: 0 }}>
              <VoiceView
                showVoiceView={showVoiceView && (!isCompact || voiceFocused)}
                voiceWidth={voiceFocused
                  ? (focusedChatHidden
                    ? "100%"
                    : (focusedVoiceMaxWidth > 0 ? `${focusedVoiceMaxWidth}px` : voiceWidth))
                  : (voiceWidth === "0px" ? "0px" : (isMaximized ? "100%" : `${shownVoiceWidth}px`))}
                maxWidth={
                  // Maximized hides the chat, so the width reserved for a
                  // minimum chat column would otherwise cap the panel.
                  isMaximized && !voiceFocused ? undefined : voiceMaxWidth
                }
                serverHost={host}
                currentServerConnected={currentServerConnected}
                currentChannelId={currentChannelId}
                clientsForHost={hostClients}
                members={hostMembers}
                clientsSpeaking={voiceClientsSpeaking}
                isConnecting={isConnecting}
                currentConnectionId={currentConnection?.id}
                onDisconnect={handleVoiceDisconnect}
                peerLatency={peerLatency}
                onDisconnectUser={canManage ? requestDisconnectUser : undefined}
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
                display: (voiceFocused && focusedChatHidden) || (!voiceFocused && isMaximized && showVoiceView && voiceWidth !== "0px") ? "none" : "flex",
                flex: voiceFocused ? `0 0 ${focusedChatWidth}px` : 1,
                minWidth: 0,
                ...(isVoiceOnThisServer && isServerUnreachable && { opacity: 0.5, pointerEvents: "none" as const }),
                transition: "opacity 0.3s ease",
              }}>
                <ChatView
                  chatMessages={chatMessages}
                  conversationKey={activeConversationId}
                  canSend={canSend}
                  sendChat={sendChat}
                  editMessage={editMessage}
                  currentUserId={currentServerUserId}
                  channelName={activeChannelName}
                  channelType={activeChannelType}
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
                  canDeleteAny={currentUserRole === "owner"}
                  maxFileSize={serverDetails.server_info?.upload_max_bytes}
                  onLoadOlder={fetchOlderMessages}
                  isLoadingOlder={isLoadingOlder}
                  hasOlderMessages={hasOlderMessages}
                  {...(isLoadingMessages !== undefined && { isLoadingMessages })}
                />
              </div>
            </div>
            <MemberSidebarPanel
              sidebarOpen={rightSidebarOpen && !voiceFocused}
              sidebarWidthPx={SIDEBAR_WIDTH_PX}
              hoverPx={SIDEBAR_HOVER_PX}
              contentRef={rightSidebarContentRef}
              isUnreachableWhileConnected={isVoiceOnThisServer && isServerUnreachable}
              onMouseEnter={voiceFocused ? undefined : openRightSidebar}
              onMouseLeave={closeRightSidebar}
              members={hostMembers}
              currentConnectionId={currentConnection?.id}
              currentServerUserId={currentServerUserId}
              currentUserRole={currentUserRole}
              currentServerConnected={currentServerConnected}
              serverHost={host}
              adminActions={currentAdminActions}
              pinned={pinMembersSidebar}
              onTogglePinned={() => setPinMembersSidebar(!pinMembersSidebar)}
            />
          </div>
        )}
      </div>

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
