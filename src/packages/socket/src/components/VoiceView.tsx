import { Avatar, Flex, Text, Tooltip } from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo,useRef, useState } from "react";
import { BsVolumeOffFill } from "react-icons/bs";
import { MdMicOff } from "react-icons/md";

import { Controls } from "@/webRTC";

import type { PeerLatencyStats } from "../hooks/usePeerLatency";
import type { Client } from "../types/clients";
import type { AdminActions,MemberInfo } from "./MemberSidebar";
import { SkeletonBase } from "./skeletons";

type Role = "owner" | "admin" | "mod" | "member";
import { getUploadsFileUrl } from "@/common";
import { useSettings } from "@/settings";

import { UserContextMenu } from "./UserContextMenu";

function latencyColor(ms: number | null): string {
  if (ms === null) return "var(--gray-9)";
  if (ms < 30) return "var(--green-9)";
  if (ms < 80) return "var(--yellow-9)";
  return "var(--red-9)";
}

export const VoiceView = ({
  showVoiceView,
  voiceWidth,
  serverHost,
  currentServerConnected,
  currentChannelId,
  clientsForHost,
  members,
  clientsSpeaking,
  isConnecting,
  currentConnectionId,
  onDisconnect,
  peerLatency,
  onDisconnectUser,
  isDragging,
  currentUserRole,
  adminActions,
}: {
  showVoiceView: boolean;
  voiceWidth: string;
  serverHost: string;
  currentServerConnected: string | null;
  currentChannelId?: string;
  clientsForHost: Record<string, Client>;
  members?: MemberInfo[];
  clientsSpeaking: Record<string, boolean>;
  isConnecting: boolean;
  currentConnectionId?: string;
  onDisconnect?: () => void;
  peerLatency?: Record<string, PeerLatencyStats>;
  onDisconnectUser?: (targetServerUserId: string) => void;
  isDragging?: boolean;
  currentUserRole?: Role;
  adminActions?: AdminActions;
}) => {
  const { showPeerLatency } = useSettings();
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(0);

  const memberByServerUserId = new Map(
    (members || []).map((m) => [m.serverUserId, m])
  );
  const avatarByServerUserId = new Map<string, string | null | undefined>(
    (members || []).map((m) => [m.serverUserId, m.avatarFileId])
  );

  const visibleCount = useMemo(() => {
    if (currentServerConnected !== serverHost) return 0;
    return Object.keys(clientsForHost).filter((id) => {
      const client = clientsForHost[id];
      const isUserConnecting = id === currentConnectionId && isConnecting;
      const isInThisChannel = currentChannelId
        ? client.voiceChannelId === currentChannelId
        : client.hasJoinedChannel;
      return isInThisChannel || isUserConnecting;
    }).length;
  }, [clientsForHost, currentServerConnected, serverHost, currentConnectionId, isConnecting, currentChannelId]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setGridHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = useMemo(() => {
    if (visibleCount <= 0) return 1;
    const ITEM_HEIGHT = 100;
    const CONTROLS_RESERVED = 80;
    const usable = gridHeight - CONTROLS_RESERVED;
    if (usable <= 0) return 1;
    const maxRows = Math.max(1, Math.floor(usable / ITEM_HEIGHT));
    return Math.max(1, Math.ceil(visibleCount / maxRows));
  }, [visibleCount, gridHeight]);

  return (
    <motion.div
      transition={isDragging ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
      animate={{
        width: showVoiceView ? voiceWidth : 0,
        paddingRight: !showVoiceView || voiceWidth === "0px" ? 0 : 8,
      }}
      style={{
        overflow: "hidden",
      }}
    >
      <Flex
        style={{
          background: "var(--gray-3)",
          borderRadius: "12px",
        }}
        height="100%"
        width="100%"
        direction="column"
        p="3"
      >
        <div
          ref={gridRef}
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gap: "var(--space-4)",
            justifyItems: "center",
            alignContent: "center",
            flexGrow: 1,
            position: "relative",
          }}
        >
          <AnimatePresence>
            {currentServerConnected === serverHost &&
              Object.keys(clientsForHost)?.map((id) => {
                const client = clientsForHost[id];
                const isUserConnecting = id === currentConnectionId && isConnecting;
                const isInThisChannel = currentChannelId
                  ? client.voiceChannelId === currentChannelId
                  : client.hasJoinedChannel;
                const shouldShow = isInThisChannel || isUserConnecting;
                const serverUserId: string | undefined = client?.serverUserId;
                const avatarFileId = serverUserId ? avatarByServerUserId.get(serverUserId) : undefined;

                const isSelf = id === currentConnectionId;

                return (
                  shouldShow && (
                    <UserContextMenu
                      serverUserId={serverUserId}
                      nickname={client.nickname}
                      isSelf={isSelf}
                      key={id}
                      canDisconnect={!!onDisconnectUser}
                      isInVoice={true}
                      onDisconnectFromVoice={onDisconnectUser && serverUserId ? () => onDisconnectUser(serverUserId) : undefined}
                      role={currentUserRole}
                      targetRole={serverUserId ? memberByServerUserId.get(serverUserId)?.role : undefined}
                      isServerMuted={serverUserId ? memberByServerUserId.get(serverUserId)?.isServerMuted : undefined}
                      isServerDeafened={serverUserId ? memberByServerUserId.get(serverUserId)?.isServerDeafened : undefined}
                      onKick={adminActions?.onKickUser && serverUserId ? () => adminActions.onKickUser!(serverUserId) : undefined}
                      onBan={adminActions?.onBanUser && serverUserId ? () => adminActions.onBanUser!(serverUserId) : undefined}
                      onServerMute={adminActions?.onServerMuteUser && serverUserId ? (muted) => adminActions.onServerMuteUser!(serverUserId, muted) : undefined}
                      onServerDeafen={adminActions?.onServerDeafenUser && serverUserId ? (deafened) => adminActions.onServerDeafenUser!(serverUserId, deafened) : undefined}
                      onChangeRole={adminActions?.onChangeRole && serverUserId ? (role) => adminActions.onChangeRole!(serverUserId, role) : undefined}
                    >
                    <motion.div
                      layout
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      style={{
                        borderRadius: "12px",
                      }}
                    >
                      <Flex align="center" justify="center" direction="column" gap="1" px="4" py="3">
                        <Flex align="center" justify="center" position="relative">
                          <Avatar
                            fallback={client.nickname[0]}
                            src={avatarFileId ? getUploadsFileUrl(serverHost, avatarFileId) : undefined}
                            style={{
                              outline: "2.5px solid",
                              outlineColor: clientsSpeaking[id] ? "var(--accent-9)" : "transparent",
                              transition: "outline-color 0.1s ease",
                            }}
                          />
                          {isUserConnecting && (
                            <Flex
                              position="absolute"
                              align="center"
                              justify="center"
                              style={{
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                background: "var(--color-panel-translucent)",
                                borderRadius: "50%",
                              }}
                            >
                              <SkeletonBase 
                                width="24px" 
                                height="24px" 
                                borderRadius="50%" 
                              />
                            </Flex>
                          )}
                          {(client.isMuted || client.isDeafened || client.isAFK) && (
                            <Flex
                              position="absolute"
                              bottom="-4px"
                              right="-4px"
                              gap="1"
                              style={{
                                background: "var(--gray-3)",
                                borderRadius: "8px",
                                padding: "2px 4px",
                                border: "1px solid var(--gray-6)",
                              }}
                            >
                              {client.isDeafened ? (
                                <BsVolumeOffFill size={10} color="var(--red-9)" />
                              ) : client.isMuted ? (
                                <MdMicOff size={12} color="var(--red-9)" />
                              ) : null}
                              {client.isAFK && (
                                <Text size="1" weight="bold" color="orange">
                                  AFK
                                </Text>
                              )}
                            </Flex>
                          )}
                        </Flex>
                        <Flex direction="column" align="center" gap="1">
                          <Text>
                            {client.nickname}
                          </Text>
                          {showPeerLatency && peerLatency?.[id]?.estimatedOneWayMs != null && (
                            <Tooltip content={`RTT: ${peerLatency[id].networkRttMs?.toFixed(0) ?? "—"}ms · Jitter: ${peerLatency[id].jitterMs?.toFixed(1) ?? "—"}ms · ${peerLatency[id].codec ?? "—"}`}>
                              <Text
                                size="1"
                                style={{
                                  color: latencyColor(peerLatency[id].estimatedOneWayMs),
                                  fontVariantNumeric: "tabular-nums",
                                  cursor: "default",
                                }}
                              >
                                {Math.round(peerLatency[id].estimatedOneWayMs!)}ms
                              </Text>
                            </Tooltip>
                          )}
                        </Flex>
                      </Flex>
                    </motion.div>
                    </UserContextMenu>
                  )
                );
              })}
          </AnimatePresence>

          <AnimatePresence>
            {currentServerConnected && (
              <motion.div
                style={{
                  width: "100%",
                  position: "absolute",
                  bottom: "0",
                  display: "flex",
                  justifyContent: "center",
                  padding: "24px",
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Controls onDisconnect={onDisconnect} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Flex>
    </motion.div>
  );
}; 