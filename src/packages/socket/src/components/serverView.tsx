import { AlertDialog, Box, Button, Dialog, Flex, IconButton, Select, Spinner, Switch, Text, TextField } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MdClose, MdRefresh, MdWifiOff } from "react-icons/md";

import { useIsCompact,useIsMobile } from "@/mobile";
import { useSettings } from "@/settings";
import { Channel, SidebarItem } from "@/settings/src/types/server";
import { useSFU } from "@/webRTC";

import { useChat } from "../hooks/useChat";
import { useLatencyReporting } from "../hooks/useLatencyReporting";
import { usePeerLatency } from "../hooks/usePeerLatency";
import { useServerManagement } from "../hooks/useServerManagement";
import { useServerState } from "../hooks/useServerState";
import { useSidebarEditor } from "../hooks/useSidebarEditor";
import { useSockets } from "../hooks/useSockets";
import { emitAuthenticated } from "../utils/tokenManager";
import { ChannelList } from "./ChannelList";
import { ChatView } from "./ChatView";
import { MemberSidebar } from "./MemberSidebar";
import { ReportsPanel } from "./ReportsPanel";
import { ServerHeader } from "./ServerHeader";
import { ServerLoadingStates } from "./ServerLoadingStates";
import { VoiceView } from "./VoiceView";

export const ServerView = () => {
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const {
    showVoiceView, setShowVoiceView, nickname, setShowSettings, setSettingsTab,
    inputMode, setInputMode, rnnoiseEnabled, setRnnoiseEnabled,
    eSportsModeEnabled, setESportsModeEnabled, noiseGate, setNoiseGate,
  } = useSettings();
  const { currentlyViewingServer, setShowRemoveServer, setLastSelectedChannelForServer } = useServerManagement();
  const { connect, currentServerConnected, isConnected, isConnecting, videoStreams, streamSources } = useSFU();
  const { serverDetailsList, clients, memberLists, serverProfiles } = useSockets();

  const {
    clientsSpeaking, voiceWidth, setVoiceWidth, userVoiceWidth, setUserVoiceWidth,
    selectedChannelId, setSelectedChannelId,
    handleVoiceDisconnect, setPendingChannelId, currentChannelId,
    currentConnection, accessToken, activeConversationId, serverFailure, hasTimeout,
    currentConnectionStatus, reconnectServer,
  } = useServerState();

  const {
    editDialogOpen, setEditDialogOpen,
    setSelectedSidebarItemId, selectedSidebarItem, effectiveSidebarItems,
    sheetChannelName, setSheetChannelName, sheetChannelIsVoice,
    setSheetChannelIsVoice, sheetRequirePtt, setSheetRequirePtt,
    sheetDisableRnnoise, setSheetDisableRnnoise, sheetMaxBitrate,
    setSheetMaxBitrate, sheetEsportsMode, setSheetEsportsMode,
    sheetSpacerHeight, setSheetSpacerHeight,
    sheetSeparatorLabel, setSheetSeparatorLabel, closeEditDialog,
    reorderSidebar, insertFromPalette, pendingDeleteItem,
    requestDeleteSidebarItem, cancelDelete, confirmDelete, saveSelectedSidebarItem,
  } = useSidebarEditor({ currentlyViewingServer, currentConnection, accessToken, serverDetailsList });

  useLatencyReporting(currentConnection);
  const peerLatency = usePeerLatency(currentConnection);

  const saveSidebarRef = useRef(saveSelectedSidebarItem);
  saveSidebarRef.current = saveSelectedSidebarItem;
  const saveSidebarTimerRef = useRef<number | null>(null);
  const debouncedSaveSidebar = useCallback(() => {
    if (saveSidebarTimerRef.current) window.clearTimeout(saveSidebarTimerRef.current);
    saveSidebarTimerRef.current = window.setTimeout(() => {
      saveSidebarTimerRef.current = null;
      saveSidebarRef.current();
    }, 600) as unknown as number;
  }, []);
  const flushSaveSidebar = useCallback(() => {
    if (saveSidebarTimerRef.current) window.clearTimeout(saveSidebarTimerRef.current);
    saveSidebarTimerRef.current = null;
    saveSidebarRef.current();
  }, []);

  const compactAutoHiddenRef = useRef(false);
  useEffect(() => {
    if (isCompact && showVoiceView) {
      compactAutoHiddenRef.current = true;
      setShowVoiceView(false);
    } else if (!isCompact && compactAutoHiddenRef.current) {
      compactAutoHiddenRef.current = false;
      setShowVoiceView(true);
    }
  }, [isCompact, setShowVoiceView, showVoiceView]);

  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const dragMinimizedRef = useRef(false);

  const VOICE_MIN_WIDTH = 200;
  const VOICE_MAX_WIDTH = 800;

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingResize(true);
    dragMinimizedRef.current = false;
    dragStartX.current = e.clientX;
    dragStartWidth.current = parseInt(voiceWidth) || userVoiceWidth;
  }, [voiceWidth, userVoiceWidth]);

  useEffect(() => {
    if (!isDraggingResize) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rawWidth = dragStartWidth.current + (e.clientX - dragStartX.current);

      if (rawWidth < VOICE_MIN_WIDTH) {
        if (!dragMinimizedRef.current) {
          dragMinimizedRef.current = true;
          setVoiceWidth("0px");
        }
      } else {
        dragMinimizedRef.current = false;
        setVoiceWidth(`${Math.min(VOICE_MAX_WIDTH, rawWidth)}px`);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDraggingResize(false);
      const rawWidth = dragStartWidth.current + (e.clientX - dragStartX.current);

      if (rawWidth < VOICE_MIN_WIDTH) {
        setShowVoiceView(false);
        setVoiceWidth(`${userVoiceWidth}px`);
      } else {
        const clamped = Math.min(VOICE_MAX_WIDTH, Math.max(VOICE_MIN_WIDTH, rawWidth));
        setVoiceWidth(`${clamped}px`);
        setUserVoiceWidth(clamped);
      }
      dragMinimizedRef.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingResize, userVoiceWidth, setShowVoiceView, setVoiceWidth, setUserVoiceWidth]);

  const prevSettingsRef = useRef<{ inputMode: string; rnnoiseEnabled: boolean; eSportsModeEnabled: boolean; noiseGate: number } | null>(null);

  const applyChannelSettings = useCallback((channel: Channel) => {
    const needsPtt = channel.requirePushToTalk && inputMode !== "push_to_talk";
    const needsNoRnnoise = channel.disableRnnoise && rnnoiseEnabled;
    const needsEsports = channel.eSportsMode && !eSportsModeEnabled;
    if (!needsPtt && !needsNoRnnoise && !needsEsports) return;

    prevSettingsRef.current = { inputMode, rnnoiseEnabled, eSportsModeEnabled, noiseGate };
    const messages: string[] = [];
    if (needsEsports) {
      setESportsModeEnabled(true);
      messages.push("eSports mode activated");
    } else {
      if (needsPtt) {
        setInputMode("push_to_talk");
        messages.push("Push to Talk enabled");
      }
      if (needsNoRnnoise) {
        setRnnoiseEnabled(false);
        messages.push("RNNoise disabled");
      }
    }
    toast(`Channel rules applied: ${messages.join(", ")}`, { icon: "⚡" });
  }, [inputMode, rnnoiseEnabled, eSportsModeEnabled, noiseGate, setInputMode, setRnnoiseEnabled, setESportsModeEnabled]);

  const restoreChannelSettings = useCallback(() => {
    if (!prevSettingsRef.current) return;
    const prev = prevSettingsRef.current;
    setESportsModeEnabled(prev.eSportsModeEnabled);
    setInputMode(prev.inputMode as "voice_activity" | "push_to_talk");
    setRnnoiseEnabled(prev.rnnoiseEnabled);
    setNoiseGate(prev.noiseGate);
    prevSettingsRef.current = null;
    toast("Settings restored to your defaults", { icon: "↩" });
  }, [setInputMode, setRnnoiseEnabled, setESportsModeEnabled, setNoiseGate]);

  useEffect(() => {
    if (!isConnected) restoreChannelSettings();
  }, [isConnected, restoreChannelSettings]);

  const currentServerUserId = currentlyViewingServer && currentConnection?.id
    ? clients[currentlyViewingServer.host]?.[currentConnection.id]?.serverUserId
    : undefined;

  const {
    chatMessages, canSend, sendChat, isLoadingMessages,
    isRateLimited, rateLimitCountdown, isVoiceChannelTextChat,
    canViewVoiceChannelText, activeChannelName, restoreText, clearRestoreText,
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

  const handleDisconnectUser = useCallback((targetServerUserId: string) => {
    if (!currentConnection || !currentlyViewingServer) return;
    emitAuthenticated(currentConnection, "voice:disconnect:user", { targetServerUserId }, currentlyViewingServer.host);
  }, [currentConnection, currentlyViewingServer]);

  const handleKickUser = useCallback((targetServerUserId: string) => {
    if (!currentConnection || !currentlyViewingServer) return;
    emitAuthenticated(currentConnection, "server:kick", { targetServerUserId }, currentlyViewingServer.host);
  }, [currentConnection, currentlyViewingServer]);

  const handleBanUser = useCallback((targetServerUserId: string) => {
    if (!currentConnection || !currentlyViewingServer) return;
    emitAuthenticated(currentConnection, "server:ban", { targetServerUserId }, currentlyViewingServer.host);
  }, [currentConnection, currentlyViewingServer]);

  const [pendingDisconnectUser, setPendingDisconnectUser] = useState<{ id: string; nickname: string } | null>(null);
  const [pendingKickUser, setPendingKickUser] = useState<{ id: string; nickname: string } | null>(null);
  const [pendingBanUser, setPendingBanUser] = useState<{ id: string; nickname: string } | null>(null);

  const [reportsOpen, setReportsOpen] = useState(false);
  const [pendingReportCount, setPendingReportCount] = useState(0);

  const currentRole = currentlyViewingServer
    ? serverDetailsList[currentlyViewingServer.host]?.server_info?.role
    : undefined;
  const isAdmin = currentRole === "owner" || currentRole === "admin";

  useEffect(() => {
    if (!currentConnection) return;
    const onReportsList = (payload: { reports: Array<unknown> }) => {
      setPendingReportCount(payload.reports?.length ?? 0);
    };
    currentConnection.on("reports:list", onReportsList);

    if (isAdmin && accessToken) {
      currentConnection.emit("reports:list", { accessToken });
    }

    return () => { currentConnection.off("reports:list", onReportsList); };
  }, [currentConnection, isAdmin, accessToken]);

  const lookupNickname = useCallback((serverUserId: string) => {
    const members = currentlyViewingServer ? memberLists[currentlyViewingServer.host] : undefined;
    return members?.find((m) => m.serverUserId === serverUserId)?.nickname || "this user";
  }, [currentlyViewingServer, memberLists]);

  const requestDisconnectUser = useCallback((targetServerUserId: string) => {
    setPendingDisconnectUser({ id: targetServerUserId, nickname: lookupNickname(targetServerUserId) });
  }, [lookupNickname]);

  const requestKickUser = useCallback((targetServerUserId: string) => {
    setPendingKickUser({ id: targetServerUserId, nickname: lookupNickname(targetServerUserId) });
  }, [lookupNickname]);

  const requestBanUser = useCallback((targetServerUserId: string) => {
    setPendingBanUser({ id: targetServerUserId, nickname: lookupNickname(targetServerUserId) });
  }, [lookupNickname]);

  const handleServerMuteUser = useCallback((targetServerUserId: string, muted: boolean) => {
    if (!currentConnection || !accessToken) return;
    currentConnection.emit("server:mute", { accessToken, targetServerUserId, muted });
  }, [currentConnection, accessToken]);

  const handleServerDeafenUser = useCallback((targetServerUserId: string, deafened: boolean) => {
    if (!currentConnection || !accessToken) return;
    currentConnection.emit("server:deafen", { accessToken, targetServerUserId, deafened });
  }, [currentConnection, accessToken]);

  const handleChangeRole = useCallback((targetServerUserId: string, role: string) => {
    if (!currentConnection || !accessToken) return;
    currentConnection.emit("server:roles:set", { accessToken, serverUserId: targetServerUserId, role });
  }, [currentConnection, accessToken]);

  if (!currentlyViewingServer) return null;
  const serverDetails = serverDetailsList[currentlyViewingServer.host];
  const serverNickname = serverProfiles[currentlyViewingServer.host]?.nickname || nickname;
  const channelById = new Map((serverDetails?.channels || []).map((c) => [c.id, c]));
  if (!serverDetails) {
    return (
      <ServerLoadingStates
        serverFailure={serverFailure}
        hasTimeout={hasTimeout}
        connectionStatus={currentConnectionStatus}
        onReconnect={() => currentlyViewingServer && reconnectServer(currentlyViewingServer.host)}
      />
    );
  }

  const isServerUnreachable = currentConnectionStatus === 'disconnected' || currentConnectionStatus === 'reconnecting';
  const isConnectedToVoiceOnThisServer = isConnected && currentServerConnected === currentlyViewingServer.host;
  const currentUserRole = serverDetails?.server_info?.role;
  const canManage = currentUserRole === "owner" || currentUserRole === "admin";
  const currentAdminActions = canManage ? {
    onDisconnectUser: requestDisconnectUser,
    onKickUser: requestKickUser,
    onBanUser: requestBanUser,
    onServerMuteUser: handleServerMuteUser,
    onServerDeafenUser: handleServerDeafenUser,
    onChangeRole: currentUserRole === "owner" ? handleChangeRole : undefined,
  } : undefined;

  const handleChannelClick = (channel: Channel) => {
    switch (channel.type) {
      case "voice": {
        const isAlreadyConnectedToThis =
          isConnected && currentServerConnected === currentlyViewingServer.host && currentChannelId === channel.id;

        if (isAlreadyConnectedToThis) {
          if (selectedChannelId === channel.id) {
            setShowVoiceView(!showVoiceView);
          } else {
            setSelectedChannelId(channel.id);
            setShowVoiceView(true);
          }
          return;
        }

        setShowVoiceView(true);
        setPendingChannelId(null);
        applyChannelSettings(channel);
        connect(channel.id, channel.eSportsMode, channel.maxBitrate).catch((error) => {
          console.error("SFU connection failed:", error);
          if (error instanceof Error && error.message.includes("Microphone not available")) {
            setPendingChannelId(channel.id);
            setSettingsTab("audio");
            setShowSettings(true);
            toast.error("No microphone selected. Please choose a device in Settings → Audio.");
          } else if (error instanceof Error) {
            toast.error(error.message);
          } else {
            toast.error("Failed to connect to voice channel");
          }
        });
        break;
      }
      case "text":
        setSelectedChannelId(channel.id);
        if (currentlyViewingServer) {
          setLastSelectedChannelForServer(currentlyViewingServer.host, channel.id);
        }
        break;
    }
  };

  return (
    <>
      {isDraggingResize && (
        <div style={{ position: "fixed", inset: 0, cursor: "grabbing", zIndex: 9999 }} />
      )}
      <Flex width="100%" height="100%" gap="4" direction="column">
        {isServerUnreachable && (
          <Flex
            align="center"
            gap="3"
            px="3"
            py="2"
            style={{
              flexShrink: 0,
              borderRadius: "var(--radius-5)",
              background: currentConnectionStatus === 'reconnecting'
                ? "var(--orange-a3)"
                : "var(--red-a3)",
              border: `1px solid ${currentConnectionStatus === 'reconnecting' ? "var(--orange-a5)" : "var(--red-a5)"}`,
            }}
          >
            {currentConnectionStatus === 'reconnecting'
              ? <Spinner size="1" />
              : <MdWifiOff size={14} color="var(--red-9)" style={{ flexShrink: 0 }} />}
            <Text size="2" weight="medium" style={{ flex: 1 }}>
              {currentConnectionStatus === 'reconnecting'
                ? 'Reconnecting to server...'
                : 'Server is unreachable'}
            </Text>
            {currentConnectionStatus === 'disconnected' && (
              <Button
                size="1"
                variant="soft"
                style={{ flexShrink: 0 }}
                onClick={() => currentlyViewingServer && reconnectServer(currentlyViewingServer.host)}
              >
                <MdRefresh size={12} />
                Reconnect
              </Button>
            )}
          </Flex>
        )}
        <Flex
          width="100%"
          style={{
            flex: 1,
            overflow: "hidden",
            ...(isServerUnreachable && !isConnectedToVoiceOnThisServer && {
              opacity: 0.5,
              pointerEvents: 'none' as const,
            }),
            transition: 'opacity 0.3s ease',
          }}
          gap="4"
        >
        <Box
          width={{ sm: "240px", initial: "100%" }}
          style={{
            position: "relative",
            ...(isConnectedToVoiceOnThisServer && isServerUnreachable && {
              opacity: 0.5,
              pointerEvents: 'none' as const,
            }),
            transition: 'opacity 0.3s ease',
          }}
        >
          <Flex
            direction="column"
            height="100%"
            width="100%"
            align="center"
            gap="4"
          >
              <ServerHeader
                serverName={serverDetailsList[currentlyViewingServer.host]?.server_info?.name || currentlyViewingServer?.name}
                role={serverDetailsList[currentlyViewingServer.host]?.server_info?.role}
                onOpenSettings={() => {
                  window.dispatchEvent(new CustomEvent("server_settings_open", {
                    detail: { host: currentlyViewingServer.host }
                  }));
                }}
                onOpenReports={() => setReportsOpen(true)}
                pendingReportCount={pendingReportCount}
                onLeave={() =>
                  currentlyViewingServer &&
                  setShowRemoveServer(currentlyViewingServer.host)
                }
              />

              <Box style={{ flex: 1, width: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
                <ChannelList
                  channels={serverDetailsList[currentlyViewingServer.host]?.channels || []}
                  items={effectiveSidebarItems}
                  serverHost={currentlyViewingServer.host}
                  clients={clients[currentlyViewingServer.host] || {}}
                  members={memberLists[currentlyViewingServer.host] || []}
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
              </Box>
          </Flex>
        </Box>
        {!isMobile && (
          <Flex flexGrow="1">
            <VoiceView
              showVoiceView={showVoiceView && !isCompact}
              voiceWidth={voiceWidth}
              serverHost={currentlyViewingServer.host}
              currentServerConnected={currentServerConnected}
              currentChannelId={currentChannelId}
              clientsForHost={clients[currentlyViewingServer.host] || {}}
              members={memberLists[currentlyViewingServer.host] || []}
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
            />

            {!isCompact && (isDraggingResize || (showVoiceView && voiceWidth !== "0px")) && (
              <div
                onMouseDown={handleResizeMouseDown}
                style={{
                  width: "8px",
                  marginRight: "8px",
                  cursor: isDraggingResize ? "grabbing" : "grab",
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  userSelect: "none",
                }}
              >
                <div
                  style={{
                    width: "3px",
                    height: "40px",
                    borderRadius: "2px",
                    background: isDraggingResize ? "var(--accent-9)" : "var(--gray-6)",
                    transition: "background 0.15s",
                  }}
                />
              </div>
            )}

            <div style={{
              display: 'flex',
              flex: 1,
              minWidth: 0,
              ...(isConnectedToVoiceOnThisServer && isServerUnreachable && {
                opacity: 0.5,
                pointerEvents: 'none' as const,
              }),
              transition: 'opacity 0.3s ease',
            }}>
              <ChatView
                chatMessages={chatMessages}
                canSend={canSend}
                sendChat={sendChat}
                currentUserId={currentServerUserId}
                channelName={activeChannelName}
                currentUserNickname={serverNickname}
                socketConnection={currentConnection}
                serverHost={currentlyViewingServer.host}
                memberList={memberLists[currentlyViewingServer.host]?.reduce((acc, member) => {
                  acc[member.serverUserId] = {
                    ...member
                  };
                  return acc;
                }, {} as Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null }>) || {}}
                isRateLimited={isRateLimited}
                rateLimitCountdown={rateLimitCountdown}
                canViewVoiceChannelText={canViewVoiceChannelText}
                isVoiceChannelTextChat={isVoiceChannelTextChat}
                restoreText={restoreText}
                clearRestoreText={clearRestoreText}
                canDeleteAny={serverDetails?.server_info?.role === "owner"}
                maxFileSize={serverDetails?.server_info?.upload_max_bytes}
                {...(isLoadingMessages !== undefined && { isLoadingMessages })}
              />
            </div>
          </Flex>
        )}

        {!isCompact && (
          <div style={{
            ...(isConnectedToVoiceOnThisServer && isServerUnreachable && {
              opacity: 0.5,
              pointerEvents: 'none' as const,
            }),
            transition: 'opacity 0.3s ease',
          }}>
          <MemberSidebar
            members={memberLists[currentlyViewingServer.host] || []}
            currentConnectionId={currentConnection?.id}
            currentServerUserId={currentServerUserId}
            currentUserRole={currentUserRole}
            clientsSpeaking={clientsSpeaking}
            currentServerConnected={currentServerConnected}
            serverHost={currentlyViewingServer.host}
            adminActions={currentAdminActions}
          />
          </div>
        )}
        </Flex>
      </Flex>

      <Dialog.Root open={editDialogOpen} onOpenChange={(open) => { if (!open) { flushSaveSidebar(); closeEditDialog(); } }}>
        <Dialog.Content maxWidth="480px">
          <Flex direction="column" gap="4">
            <Flex align="center" justify="between">
              <Dialog.Title as="h2" size="5" weight="bold" style={{ margin: 0 }}>
                {selectedSidebarItem?.kind === "channel" ? "Channel settings"
                  : selectedSidebarItem?.kind === "separator" ? "Separator settings"
                  : "Spacer settings"}
              </Dialog.Title>
              <Dialog.Close>
                <IconButton variant="soft" color="gray">
                  <MdClose size={16} />
                </IconButton>
              </Dialog.Close>
            </Flex>

            {selectedSidebarItem?.kind === "channel" && (
              <>
                <Flex direction="column" gap="2">
                  <Text size="2" weight="medium">Name</Text>
                  <TextField.Root
                    value={sheetChannelName}
                    onChange={(e) => setSheetChannelName(e.target.value)}
                    onBlur={flushSaveSidebar}
                    onKeyDown={(e) => { if (e.key === "Enter") { flushSaveSidebar(); closeEditDialog(); } }}
                    placeholder="Channel name"
                  />
                </Flex>
                <Flex align="center" justify="between">
                  <Text size="2" weight="medium">Voice channel</Text>
                  <Switch checked={sheetChannelIsVoice} onCheckedChange={(v) => { setSheetChannelIsVoice(v); debouncedSaveSidebar(); }} />
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
                        debouncedSaveSidebar();
                      }} />
                    </Flex>
                    <Flex align="center" justify="between">
                      <Flex direction="column" gap="1">
                        <Text size="2" weight="medium">Require Push to Talk</Text>
                        <Text size="1" color="gray">Users must hold a key to transmit</Text>
                      </Flex>
                      <Switch checked={sheetRequirePtt} onCheckedChange={(v) => { setSheetRequirePtt(v); debouncedSaveSidebar(); }} />
                    </Flex>
                    <Flex align="center" justify="between">
                      <Flex direction="column" gap="1">
                        <Text size="2" weight="medium">Disable Noise Reduction</Text>
                        <Text size="1" color="gray">Raw audio with no processing for lower latency</Text>
                      </Flex>
                      <Switch checked={sheetDisableRnnoise} disabled={sheetEsportsMode} onCheckedChange={(v) => { setSheetDisableRnnoise(v); debouncedSaveSidebar(); }} />
                    </Flex>
                    <Flex direction="column" gap="2">
                      <Text size="2" weight="medium">Max Bitrate</Text>
                      <Select.Root
                        value={sheetMaxBitrate || "default"}
                        onValueChange={(v) => { setSheetMaxBitrate(v === "default" ? "" : v); debouncedSaveSidebar(); }}
                      >
                        <Select.Trigger />
                        <Select.Content>
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
                  onBlur={flushSaveSidebar}
                  onKeyDown={(e) => { if (e.key === "Enter") { flushSaveSidebar(); closeEditDialog(); } }}
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
                  onBlur={flushSaveSidebar}
                  onKeyDown={(e) => { if (e.key === "Enter") { flushSaveSidebar(); closeEditDialog(); } }}
                  placeholder="Optional"
                />
              </Flex>
            )}

          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      <AlertDialog.Root open={!!pendingDeleteItem} onOpenChange={(open) => { if (!open) cancelDelete(); }}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Delete {pendingDeleteItem?.kind === "channel" ? "channel" : "item"}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            {pendingDeleteItem?.kind === "channel"
              ? `This will permanently delete the channel "${channelById.get(pendingDeleteItem.channelId ?? pendingDeleteItem.id)?.name || "this channel"}" and all associated data. This action cannot be undone.`
              : "This will remove this item from the sidebar. This action cannot be undone."}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={confirmDelete}>Delete</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root open={!!pendingDisconnectUser} onOpenChange={(open) => { if (!open) setPendingDisconnectUser(null); }}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Disconnect {pendingDisconnectUser?.nickname}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This will disconnect {pendingDisconnectUser?.nickname} from the voice channel.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={() => { if (pendingDisconnectUser) { handleDisconnectUser(pendingDisconnectUser.id); setPendingDisconnectUser(null); } }}>Disconnect</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root open={!!pendingKickUser} onOpenChange={(open) => { if (!open) setPendingKickUser(null); }}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Kick {pendingKickUser?.nickname}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to kick {pendingKickUser?.nickname} from the server?
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={() => { if (pendingKickUser) { handleKickUser(pendingKickUser.id); setPendingKickUser(null); } }}>Kick</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root open={!!pendingBanUser} onOpenChange={(open) => { if (!open) setPendingBanUser(null); }}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Ban {pendingBanUser?.nickname}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Are you sure you want to ban {pendingBanUser?.nickname}? They will not be able to rejoin.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={() => { if (pendingBanUser) { handleBanUser(pendingBanUser.id); setPendingBanUser(null); } }}>Ban</Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <ReportsPanel
        isOpen={reportsOpen}
        onClose={() => setReportsOpen(false)}
        socket={currentConnection}
        serverHost={currentlyViewingServer.host}
        memberList={memberLists[currentlyViewingServer.host]}
      />
    </>
  );
};
