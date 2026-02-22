import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Avatar, ContextMenu, Flex, Slider, Text, Tooltip } from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdClose, MdMicOff, MdScreenShare, MdVideocam, MdVolumeOff, MdVolumeUp } from "react-icons/md";

import { useCamera as useLocalCamera, useScreenShare as useLocalScreenShare, useVoiceLatency } from "@/audio";
import { getUploadsFileUrl } from "@/common";
import { useSettings } from "@/settings";
import { Controls } from "@/webRTC";
import type { StreamSources } from "@/webRTC/src/types/SFU";

import type { PeerLatencyStats } from "../hooks/usePeerLatency";
import type { Client } from "../types/clients";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { popoutStream } from "../utils/popoutVideo";
import { SkeletonBase } from "./skeletons";
import { UserContextMenu } from "./UserContextMenu";

type Role = "owner" | "admin" | "mod" | "member";

function VideoCard({
  stream,
  nickname,
  mirrored,
  isSpeaking,
  statusIcons,
  objectFit = "cover",
  onClick,
}: {
  stream: MediaStream;
  nickname: string;
  mirrored?: boolean;
  isSpeaking?: boolean;
  statusIcons?: ReactNode;
  objectFit?: "cover" | "contain";
  onClick?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: "var(--radius-3)",
        overflow: "hidden",
        background: "#000",
        outline: isSpeaking ? "2.5px solid var(--accent-9)" : "2.5px solid transparent",
        transition: "outline-color 0.1s ease",
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit,
          transform: mirrored ? "scaleX(-1)" : undefined,
        }}
      />
      <Flex
        align="center"
        gap="1"
        px="2"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
          padding: "12px 8px 4px",
        }}
      >
        <Text size="1" weight="medium" style={{ color: "#fff" }} truncate>
          {nickname}
        </Text>
        {statusIcons}
      </Flex>
    </div>
  );
}

function FocusedVideoView({
  stream,
  title,
  audioStreamId,
  streamSources,
  objectFit = "contain",
  mirrored,
  onClose,
}: {
  stream: MediaStream;
  title: string;
  audioStreamId?: string;
  streamSources?: StreamSources;
  objectFit?: "cover" | "contain";
  mirrored?: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(100);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleVolumeChange = useCallback((values: number[]) => {
    const v = values[0];
    setVolume(v);
    if (audioStreamId && streamSources?.[audioStreamId]) {
      const gain = streamSources[audioStreamId].gain;
      gain.gain.setValueAtTime(v / 100, 0);
    }
  }, [audioStreamId, streamSources]);

  return (
    <Flex
      direction="column"
      gap="2"
      style={{ flex: 1, minHeight: 0, position: "relative" }}
    >
      <Flex
        align="center"
        gap="2"
        px="2"
        style={{
          background: "var(--gray-4)",
          borderRadius: "var(--radius-3)",
          padding: "4px 8px",
          flexShrink: 0,
        }}
      >
        <Text size="1" weight="medium" truncate style={{ flex: 1 }}>
          {title}
        </Text>
        {audioStreamId && streamSources?.[audioStreamId] && (
          <Flex align="center" gap="2" style={{ minWidth: 100 }}>
            <MdVolumeUp size={14} />
            <Slider
              size="1"
              value={[volume]}
              onValueChange={handleVolumeChange}
              min={0}
              max={200}
              step={1}
              style={{ flex: 1 }}
            />
          </Flex>
        )}
        <Flex
          asChild
          align="center"
          justify="center"
          style={{ cursor: "pointer", opacity: 0.7, flexShrink: 0 }}
          onClick={onClose}
        >
          <button style={{ background: "none", border: "none", color: "inherit", padding: 0, cursor: "pointer" }}>
            <MdClose size={16} />
          </button>
        </Flex>
      </Flex>
      <div
        style={{
          flex: 1,
          position: "relative",
          borderRadius: "var(--radius-3)",
          overflow: "hidden",
          background: "#000",
          minHeight: 0,
        }}
      >
        <video
          ref={ref}
          autoPlay
          playsInline
          muted
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit,
            transform: mirrored ? "scaleX(-1)" : undefined,
          }}
        />
      </div>
    </Flex>
  );
}

function latencyColor(ms: number | null): string {
  if (ms === null) return "var(--gray-9)";
  if (ms < 30) return "var(--green-9)";
  if (ms < 80) return "var(--yellow-9)";
  return "var(--red-9)";
}

function SortableParticipant({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 10 : undefined,
    cursor: isDragging ? "grabbing" : "grab",
    borderRadius: "var(--radius-5)",
    boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.35)" : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

interface FocusedStreamInfo {
  itemId: string;
  stream: MediaStream;
  title: string;
  audioStreamId?: string;
  objectFit: "cover" | "contain";
  mirrored?: boolean;
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
  videoStreams,
  streamSources,
  onFocusChange,
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
  videoStreams?: Record<string, MediaStream>;
  streamSources?: StreamSources;
  onFocusChange?: (focused: boolean) => void;
}) => {
  const { showPeerLatency, cameraMirrored } = useSettings();
  const { latency: selfLatency } = useVoiceLatency(showPeerLatency);
  const { screenShareActive: localScreenActive, screenVideoStream: localScreenStream } = useLocalScreenShare();
  const { cameraStream: localCameraStream } = useLocalCamera();
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(0);
  const [gridWidth, setGridWidth] = useState(0);
  const [focusedStream, setFocusedStream] = useState<FocusedStreamInfo | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const memberByServerUserId = new Map(
    (members || []).map((m) => [m.serverUserId, m])
  );
  const avatarByServerUserId = new Map<string, string | null | undefined>(
    (members || []).map((m) => [m.serverUserId, m.avatarFileId])
  );

  const visibleClients = useMemo(() => {
    if (currentServerConnected !== serverHost) return [];
    return Object.keys(clientsForHost).filter((id) => {
      const client = clientsForHost[id];
      const isUserConnecting = id === currentConnectionId && isConnecting;
      const isInThisChannel = currentChannelId
        ? client.voiceChannelId === currentChannelId
        : client.hasJoinedChannel;
      return isInThisChannel || isUserConnecting;
    });
  }, [clientsForHost, currentServerConnected, serverHost, currentConnectionId, isConnecting, currentChannelId]);

  // Build the list of grid items: participants + screen share tiles
  const gridItems = useMemo(() => {
    const items: string[] = [];
    for (const id of visibleClients) {
      items.push(id);
      const client = clientsForHost[id];
      const isSelf = id === currentConnectionId;
      if (isSelf && localScreenActive && localScreenStream) {
        items.push(`screen:${id}`);
      } else if (!isSelf && client.screenShareEnabled && client.screenShareVideoStreamID) {
        items.push(`screen:${id}`);
      }
    }
    return items;
  }, [visibleClients, clientsForHost, currentConnectionId, localScreenActive, localScreenStream]);

  const [customOrder, setCustomOrder] = useState<string[]>([]);

  const orderedItems = useMemo(() => {
    const visibleSet = new Set(gridItems);
    const ordered = customOrder.filter((id) => visibleSet.has(id));
    const orderedSet = new Set(ordered);
    for (const id of gridItems) {
      if (!orderedSet.has(id)) ordered.push(id);
    }
    return ordered;
  }, [gridItems, customOrder]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = orderedItems.indexOf(String(active.id));
      const newIndex = orderedItems.indexOf(String(over.id));
      if (oldIndex !== -1 && newIndex !== -1) {
        setCustomOrder(arrayMove(orderedItems, oldIndex, newIndex));
      }
    }
  }, [orderedItems]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setGridHeight(entry.contentRect.height);
      setGridWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const itemCount = gridItems.length;
  const useAutoLayout = gridWidth > 0 && gridWidth < 300;

  const columns = useMemo(() => {
    if (itemCount <= 0) return 1;
    const ITEM_HEIGHT = 100;
    const CONTROLS_RESERVED = 80;
    const usable = gridHeight - CONTROLS_RESERVED;
    if (usable <= 0) return 1;
    const maxRows = Math.max(1, Math.floor(usable / ITEM_HEIGHT));
    return Math.max(1, Math.ceil(itemCount / maxRows));
  }, [itemCount, gridHeight]);

  const isFocused = !!focusedStream;

  const displayItems = useMemo(() => {
    if (!focusedStream) return orderedItems;
    return orderedItems.filter((id) => id !== focusedStream.itemId);
  }, [orderedItems, focusedStream]);

  // Close focused view if the underlying stream ends
  useEffect(() => {
    if (!focusedStream) return;
    const tracks = focusedStream.stream.getTracks();
    const onEnded = () => {
      if (focusedStream.stream.getTracks().every((t) => t.readyState === "ended")) {
        setFocusedStream(null);
        onFocusChange?.(false);
      }
    };
    for (const t of tracks) t.addEventListener("ended", onEnded);
    return () => { for (const t of tracks) t.removeEventListener("ended", onEnded); };
  }, [focusedStream, onFocusChange]);

  const handleFocus = useCallback((info: FocusedStreamInfo) => {
    setFocusedStream((prev) => {
      if (prev?.itemId === info.itemId) return null;
      return info;
    });
  }, []);

  const handleCloseFocus = useCallback(() => {
    setFocusedStream(null);
  }, []);

  const renderCardContent = (itemId: string, compact?: boolean) => {
    const isScreenTile = itemId.startsWith("screen:");
    const clientId = isScreenTile ? itemId.slice(7) : itemId;
    const client = clientsForHost[clientId];
    if (!client) return null;

    const isSelf = clientId === currentConnectionId;
    const serverUserId: string | undefined = client?.serverUserId;
    const avatarFileId = serverUserId ? avatarByServerUserId.get(serverUserId) : undefined;
    const isUserConnecting = clientId === currentConnectionId && isConnecting;

    if (isScreenTile) {
      const screenStream = isSelf
        ? localScreenStream
        : (client.screenShareVideoStreamID && videoStreams?.[client.screenShareVideoStreamID])
          ? videoStreams[client.screenShareVideoStreamID]
          : null;
      if (!screenStream) return null;
      const screenTitle = isSelf ? "Your Screen" : `${client.nickname}'s Screen`;

      return (
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            <VideoCard
              stream={screenStream}
              nickname={screenTitle}
              objectFit="contain"
              statusIcons={<MdScreenShare size={10} color="var(--blue-9)" />}
              onClick={() => handleFocus({
                itemId,
                stream: screenStream,
                title: screenTitle,
                audioStreamId: (!isSelf && client.screenShareAudioStreamID) || undefined,
                objectFit: "contain",
              })}
            />
          </ContextMenu.Trigger>
          <ContextMenu.Content style={{ minWidth: 160 }} onCloseAutoFocus={(e) => e.preventDefault()}>
            <ContextMenu.Label style={{ fontWeight: "bold" }}>{screenTitle}</ContextMenu.Label>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => popoutStream(screenStream, screenTitle)}>Pop out video</ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
      );
    }

    return (
      <UserContextMenu
        serverUserId={serverUserId}
        nickname={client.nickname}
        isSelf={isSelf}
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
        onPopoutVideo={(() => {
          const cam = isSelf
            ? localCameraStream
            : (client.cameraEnabled && client.cameraStreamID && videoStreams?.[client.cameraStreamID]) || null;
          if (!cam) return undefined;
          return () => { popoutStream(cam, isSelf ? "Your Camera" : `${client.nickname}'s Camera`); };
        })()}
      >
        {(() => {
          const hasCameraStream =
            (isSelf && localCameraStream) ||
            (!isSelf && client.cameraEnabled && client.cameraStreamID && videoStreams?.[client.cameraStreamID]);

          const statusBadges = (
            <>
              {(client.isMuted || client.isDeafened) && (
                client.isDeafened
                  ? <MdVolumeOff size={12} color="var(--red-9)" />
                  : <MdMicOff size={12} color="var(--red-9)" />
              )}
              {client.isAFK && <Text size="1" weight="bold" style={{ color: "#fff" }}>AFK</Text>}
              {client.screenShareEnabled && <MdScreenShare size={10} color="var(--blue-9)" />}
            </>
          );

          if (hasCameraStream) {
            const camStream = isSelf ? localCameraStream! : videoStreams![client.cameraStreamID!];
            return (
              <Flex direction="column" gap="1" align="center" style={{ width: "100%" }}>
                <VideoCard
                  stream={camStream}
                  nickname={client.nickname}
                  mirrored={isSelf ? cameraMirrored : false}
                  isSpeaking={clientsSpeaking[clientId]}
                  statusIcons={statusBadges}
                  onClick={() => handleFocus({
                    itemId,
                    stream: camStream,
                    title: isSelf ? "Your Camera" : `${client.nickname}'s Camera`,
                    objectFit: "cover",
                    mirrored: isSelf ? cameraMirrored : false,
                  })}
                />
                {!compact && showPeerLatency && (() => {
                  const stats = isSelf ? selfLatency : peerLatency?.[clientId];
                  const oneWay = isSelf ? stats?.estimatedOneWayMs : (stats as PeerLatencyStats | undefined)?.estimatedOneWayMs;
                  const rtt = isSelf ? stats?.networkRttMs : (stats as PeerLatencyStats | undefined)?.networkRttMs;
                  const jitter = isSelf ? stats?.jitterMs : (stats as PeerLatencyStats | undefined)?.jitterMs;
                  const codecStr = isSelf ? stats?.codec : (stats as PeerLatencyStats | undefined)?.codec;
                  if (oneWay == null) return null;
                  const tooltipParts = [`RTT: ${rtt?.toFixed(0) ?? "—"}ms`, `Jitter: ${jitter?.toFixed(1) ?? "—"}ms`, codecStr ?? "—"];
                  if (isSelf && selfLatency.remoteAddress) tooltipParts.push(`ICE: ${selfLatency.remoteAddress}`);
                  return (
                    <Tooltip content={tooltipParts.join(" · ")}>
                      <Text size="1" style={{ color: latencyColor(oneWay), fontVariantNumeric: "tabular-nums", cursor: "default" }}>
                        {Math.round(oneWay)}ms
                      </Text>
                    </Tooltip>
                  );
                })()}
              </Flex>
            );
          }

          return (
            <Flex align="center" justify="center" direction={compact ? "row" : "column"} gap="1" px={compact ? "2" : "4"} py={compact ? "1" : "3"}>
              <Flex align="center" justify="center" position="relative">
                <Avatar
                  size={compact ? "2" : "3"}
                  fallback={client.nickname[0]}
                  src={avatarFileId ? getUploadsFileUrl(serverHost, avatarFileId) : undefined}
                  style={{
                    outline: "2.5px solid",
                    outlineColor: clientsSpeaking[clientId] ? "var(--accent-9)" : "transparent",
                    transition: "outline-color 0.1s ease",
                  }}
                />
                {client.cameraEnabled && (
                  <Flex position="absolute" top="-4px" right="-4px" style={{ background: "var(--green-9)", borderRadius: "50%", padding: "2px" }}>
                    <MdVideocam size={10} color="white" />
                  </Flex>
                )}
                {client.screenShareEnabled && (
                  <Flex position="absolute" top="-4px" left="-4px" style={{ background: "var(--blue-9)", borderRadius: "50%", padding: "2px" }}>
                    <MdScreenShare size={10} color="white" />
                  </Flex>
                )}
                {isUserConnecting && (
                  <Flex position="absolute" align="center" justify="center" style={{ top: 0, left: 0, right: 0, bottom: 0, background: "var(--color-panel-translucent)", borderRadius: "50%" }}>
                    <SkeletonBase width="24px" height="24px" borderRadius="50%" />
                  </Flex>
                )}
                {(client.isMuted || client.isDeafened || client.isAFK) && (
                  <Flex position="absolute" bottom="-4px" right="-4px" gap="1" style={{ background: "var(--gray-3)", borderRadius: "var(--radius-4)", padding: "2px 4px", border: "1px solid var(--gray-6)" }}>
                    {client.isDeafened ? <MdVolumeOff size={12} color="var(--red-9)" /> : client.isMuted ? <MdMicOff size={12} color="var(--red-9)" /> : null}
                    {client.isAFK && <Text size="1" weight="bold" color="orange">AFK</Text>}
                  </Flex>
                )}
              </Flex>
              <Flex direction="column" align="center" gap="1">
                <Text size={compact ? "1" : undefined}>{client.nickname}</Text>
                {!compact && showPeerLatency && (() => {
                  const stats = isSelf ? selfLatency : peerLatency?.[clientId];
                  const oneWay = isSelf ? stats?.estimatedOneWayMs : (stats as PeerLatencyStats | undefined)?.estimatedOneWayMs;
                  const rtt = isSelf ? stats?.networkRttMs : (stats as PeerLatencyStats | undefined)?.networkRttMs;
                  const jitter = isSelf ? stats?.jitterMs : (stats as PeerLatencyStats | undefined)?.jitterMs;
                  const codecStr = isSelf ? stats?.codec : (stats as PeerLatencyStats | undefined)?.codec;
                  if (oneWay == null) return null;
                  const tooltipParts = [`RTT: ${rtt?.toFixed(0) ?? "—"}ms`, `Jitter: ${jitter?.toFixed(1) ?? "—"}ms`, codecStr ?? "—"];
                  if (isSelf && selfLatency.remoteAddress) tooltipParts.push(`ICE: ${selfLatency.remoteAddress}`);
                  return (
                    <Tooltip content={tooltipParts.join(" · ")}>
                      <Text size="1" style={{ color: latencyColor(oneWay), fontVariantNumeric: "tabular-nums", cursor: "default" }}>{Math.round(oneWay)}ms</Text>
                    </Tooltip>
                  );
                })()}
              </Flex>
            </Flex>
          );
        })()}
      </UserContextMenu>
    );
  };

  return (
    <motion.div
      transition={isDragging ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
      animate={{
        width: showVoiceView ? voiceWidth : 0,
        paddingRight: !showVoiceView || voiceWidth === "0px" ? 0 : 8,
      }}
      style={{ overflow: "hidden" }}
    >
      <Flex
        style={{ background: "var(--gray-3)", borderRadius: "var(--radius-5)" }}
        height="100%"
        width="100%"
        direction="column"
        p="3"
      >
        <div
          ref={gridRef}
          style={{ flexGrow: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}
        >
          {/* Focused video at top */}
          {isFocused && (
            <FocusedVideoView
              stream={focusedStream.stream}
              title={focusedStream.title}
              audioStreamId={focusedStream.audioStreamId}
              streamSources={streamSources}
              objectFit={focusedStream.objectFit}
              mirrored={focusedStream.mirrored}
              onClose={handleCloseFocus}
            />
          )}

          {/* Cards grid / strip */}
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedItems} strategy={rectSortingStrategy}>
              <div
                style={isFocused ? {
                  display: "flex",
                  gap: "var(--space-2)",
                  overflowX: "auto",
                  overflowY: "hidden",
                  paddingTop: "var(--space-2)",
                  flexShrink: 0,
                } : {
                  display: "grid",
                  gridTemplateColumns: useAutoLayout ? "1fr" : `repeat(${columns}, 1fr)`,
                  gap: "var(--space-2)",
                  justifyItems: "center",
                  alignContent: "center",
                  overflowY: "auto",
                  paddingBottom: "60px",
                  height: "100%",
                }}
              >
                <AnimatePresence>
                  {currentServerConnected === serverHost && displayItems.map((itemId) => (
                    <motion.div
                      key={itemId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      style={isFocused ? { flexShrink: 0, width: 140 } : { width: "100%" }}
                    >
                      <SortableParticipant id={itemId}>
                        {renderCardContent(itemId, isFocused)}
                      </SortableParticipant>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>

          {/* Controls overlay (normal mode) */}
          {!isFocused && (
            <AnimatePresence>
              {currentServerConnected && (
                <motion.div
                  style={{
                    position: "absolute",
                    bottom: 0, left: 0, right: 0,
                    display: "flex",
                    justifyContent: "center",
                    padding: "12px",
                    pointerEvents: "none",
                  }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div style={{ pointerEvents: "auto" }}>
                    <Controls onDisconnect={onDisconnect} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {/* Controls below (focused mode) */}
        {isFocused && currentServerConnected && (
          <Flex justify="center" py="2" flexShrink="0">
            <Controls onDisconnect={onDisconnect} />
          </Flex>
        )}
      </Flex>
    </motion.div>
  );
};
