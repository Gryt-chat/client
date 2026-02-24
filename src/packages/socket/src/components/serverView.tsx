import { Flex } from "@radix-ui/themes";
import { useCallback, useMemo } from "react";

import { useIsCompact, useIsMobile } from "@/mobile";
import { useSettings } from "@/settings";
import { SidebarItem } from "@/settings/src/types/server";
import { useSFU } from "@/webRTC";

import { useAdminActions } from "../hooks/useAdminActions";
import { useChannelSettings, useHandleChannelClick } from "../hooks/useChannelSettings";
import { useChat } from "../hooks/useChat";
import { useLatencyReporting } from "../hooks/useLatencyReporting";
import { usePeerLatency } from "../hooks/usePeerLatency";
import { useServerManagement } from "../hooks/useServerManagement";
import { useServerReports } from "../hooks/useServerReports";
import { useServerState } from "../hooks/useServerState";
import { SIDEBAR_HOVER_PX, SIDEBAR_WIDTH_PX, useMediaAutoShow, useSidebarHover, useVoiceResize } from "../hooks/useServerViewLayout";
import { useSidebarEditor } from "../hooks/useSidebarEditor";
import { useSockets } from "../hooks/useSockets";
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
  } = useSettings();
  const { currentlyViewingServer, setShowRemoveServer, setLastSelectedChannelForServer } = useServerManagement();
  const { connect, currentServerConnected, isConnected, isConnecting, videoStreams, streamSources } = useSFU();
  const { serverDetailsList, clients, memberLists, serverProfiles } = useSockets();

  const {
    clientsSpeaking, voiceWidth, setVoiceWidth, userVoiceWidth, setUserVoiceWidth,
    selectedChannelId, setSelectedChannelId,
    handleVoiceDisconnect, setPendingChannelId, currentChannelId,
    currentConnection, accessToken, activeConversationId, serverFailure, hasTimedOut,
    currentConnectionStatus, reconnectServer,
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
    voiceFocused, setVoiceFocused, isDraggingResize,
    voiceContainerRef, voiceMaxWidth, handleResizeMouseDown,
  } = useVoiceResize({ voiceWidth, userVoiceWidth, setVoiceWidth, setUserVoiceWidth, setShowVoiceView });

  const {
    leftSidebarOpen, rightSidebarOpen,
    leftSidebarContentRef, rightSidebarContentRef,
    openLeftSidebar, closeLeftSidebar, openRightSidebar, closeRightSidebar,
  } = useSidebarHover({ pinChannelsSidebar, pinMembersSidebar, isDraggingResize });

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
    handleDisconnectUser, handleKickUser, handleBanUser,
    handleServerMuteUser, handleServerDeafenUser, handleChangeRole,
    requestDisconnectUser, requestKickUser, requestBanUser,
  } = useAdminActions({ currentConnection, currentlyViewingServer, accessToken, memberLists });

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

  const handleChannelClick = useHandleChannelClick({
    currentlyViewingServer, isConnected, currentServerConnected,
    currentChannelId, selectedChannelId, isConnecting,
    showVoiceView, mediaAutoShownRef,
    setSelectedChannelId, setShowVoiceView, setPendingChannelId,
    setSettingsTab, setShowSettings, setLastSelectedChannelForServer,
    connect, applyChannelSettings, setIsMuted, setIsDeafened,
  });

  const currentAdminActions = useMemo(() => {
    const canManage = currentRole === "owner" || currentRole === "admin";
    if (!canManage) return undefined;
    return {
      onDisconnectUser: requestDisconnectUser,
      onKickUser: requestKickUser,
      onBanUser: requestBanUser,
      onServerMuteUser: handleServerMuteUser,
      onServerDeafenUser: handleServerDeafenUser,
      onChangeRole: currentRole === "owner" ? handleChangeRole : undefined,
    };
  }, [currentRole, requestDisconnectUser, requestKickUser, requestBanUser, handleServerMuteUser, handleServerDeafenUser, handleChangeRole]);

  if (!currentlyViewingServer) return null;

  const serverDetails = serverDetailsList[currentlyViewingServer.host];
  const serverNickname = serverProfiles[currentlyViewingServer.host]?.nickname || nickname;
  const channelById = new Map((serverDetails?.channels || []).map((c) => [c.id, c]));

  if (!serverDetails) {
    return (
      <ServerLoadingStates
        serverFailure={serverFailure} hasTimedOut={hasTimedOut}
        connectionStatus={currentConnectionStatus}
        onReconnect={() => reconnectServer(currentlyViewingServer.host)}
      />
    );
  }

  const host = currentlyViewingServer.host;
  const isServerUnreachable = currentConnectionStatus === "disconnected" || currentConnectionStatus === "reconnecting";
  const isVoiceOnThisServer = isConnected && currentServerConnected === host;
  const currentUserRole = serverDetails?.server_info?.role;
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";
  const hostChannels = serverDetails.channels || [];
  const hostClients = clients[host] || {};
  const hostMembers = memberLists[host] || [];
  const serverName = serverDetails.server_info?.name || currentlyViewingServer.name;

  const onOpenSettings = () => {
    window.dispatchEvent(new CustomEvent("server_settings_open", { detail: { host } }));
  };

  return (
    <>
      {isDraggingResize && (
        <div style={{ position: "fixed", inset: 0, cursor: "grabbing", zIndex: 9999 }} />
      )}
      <Flex width="100%" height="100%" gap="4" direction="column">
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
            clientsSpeaking={clientsSpeaking}
            canManage={canManage}
            onEditItem={handleEditItem}
            onDeleteItem={requestDeleteSidebarItem}
            onMoveItem={handleMoveItem}
            onReorder={reorderSidebar}
            onAddItem={handleAddItem}
            onDisconnectUser={canManage ? requestDisconnectUser : undefined}
            currentUserRole={currentUserRole}
            adminActions={currentAdminActions}
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
            videoStreams={videoStreams}
            streamSources={streamSources}
          />
        ) : (
          <Flex
            width="100%" gap="4"
            style={{
              flex: 1, overflow: "hidden",
              ...(isServerUnreachable && !isVoiceOnThisServer && { opacity: 0.5, pointerEvents: "none" as const }),
              transition: "opacity 0.3s ease",
            }}
          >
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
              clientsSpeaking={clientsSpeaking}
              canManage={canManage}
              onEditItem={handleEditItem}
              onDeleteItem={requestDeleteSidebarItem}
              onMoveItem={handleMoveItem}
              onReorder={reorderSidebar}
              onAddItem={handleAddItem}
              onDisconnectUser={canManage ? requestDisconnectUser : undefined}
              currentUserRole={currentUserRole}
              adminActions={currentAdminActions}
            />
            <Flex flexGrow="1" ref={voiceContainerRef} style={{ position: "relative", minWidth: 0 }}>
              <VoiceView
                showVoiceView={showVoiceView && (!isCompact || voiceFocused)}
                voiceWidth={voiceFocused ? (voiceMaxWidth > 0 ? `${voiceMaxWidth}px` : voiceWidth) : voiceWidth}
                maxWidth={voiceMaxWidth}
                serverHost={host}
                currentServerConnected={currentServerConnected}
                currentChannelId={currentChannelId}
                clientsForHost={hostClients}
                members={hostMembers}
                clientsSpeaking={clientsSpeaking}
                isConnecting={isConnecting}
                currentConnectionId={currentConnection?.id}
                onDisconnect={handleVoiceDisconnect}
                peerLatency={peerLatency}
                onDisconnectUser={canManage ? requestDisconnectUser : undefined}
                isDragging={isDraggingResize}
                currentUserRole={currentUserRole}
                adminActions={currentAdminActions}
                videoStreams={videoStreams}
                streamSources={streamSources}
                onFocusChange={setVoiceFocused}
              />
              {!isCompact && !voiceFocused && (isDraggingResize || (showVoiceView && voiceWidth !== "0px")) && (
                <div
                  onMouseDown={handleResizeMouseDown}
                  style={{
                    width: "8px", marginRight: "8px",
                    cursor: isDraggingResize ? "grabbing" : "grab",
                    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    userSelect: "none",
                  }}
                >
                  <div style={{
                    width: "3px", height: "40px", borderRadius: "2px",
                    background: isDraggingResize ? "var(--accent-9)" : "var(--gray-6)",
                    transition: "background 0.15s",
                  }} />
                </div>
              )}
              <div style={{
                display: "flex", flex: voiceFocused ? "0 0 320px" : 1, minWidth: 0,
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
            </Flex>
            <MemberSidebarPanel
              sidebarOpen={rightSidebarOpen}
              sidebarWidthPx={SIDEBAR_WIDTH_PX}
              hoverPx={SIDEBAR_HOVER_PX}
              contentRef={rightSidebarContentRef}
              isUnreachableWhileConnected={isVoiceOnThisServer && isServerUnreachable}
              onMouseEnter={openRightSidebar}
              onMouseLeave={closeRightSidebar}
              members={hostMembers}
              currentConnectionId={currentConnection?.id}
              currentServerUserId={currentServerUserId}
              currentUserRole={currentUserRole}
              clientsSpeaking={clientsSpeaking}
              currentServerConnected={currentServerConnected}
              serverHost={host}
              adminActions={currentAdminActions}
              pinned={pinMembersSidebar}
              onTogglePinned={() => setPinMembersSidebar(!pinMembersSidebar)}
            />
          </Flex>
        )}
      </Flex>

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
