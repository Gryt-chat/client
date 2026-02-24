import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Flex } from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useCamera as useLocalCamera, useScreenShare as useLocalScreenShare, useVoiceLatency } from "@/audio";
import { useSettings } from "@/settings";
import { Controls } from "@/webRTC";
import type { StreamSources } from "@/webRTC/src/types/SFU";

import type { PeerLatencyStats } from "../hooks/usePeerLatency";
import { usePopoutStreams } from "../hooks/usePopoutStreams";
import type { Client } from "../types/clients";
import { FocusedVideoView } from "./FocusedVideoView";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import type { FocusedStreamInfo } from "./VoiceParticipantCard";
import { VoiceParticipantCard } from "./VoiceParticipantCard";

type Role = "owner" | "admin" | "mod" | "member";

const GRID_GAP = 8;
const MIN_TILE_WIDTH = 140;
const CONTROLS_HEIGHT = 80;
const TILE_ASPECT = 4 / 3;

/**
 * Tries every possible column count and picks the one that maximises
 * tile area while keeping tiles at least MIN_TILE_WIDTH wide.
 * Scores each candidate against a target aspect ratio so the layout
 * looks balanced regardless of container shape (same idea as Zoom/Meet).
 */
function computeOptimalColumns(
  width: number,
  height: number,
  count: number,
): number {
  if (count <= 0 || width <= 0 || height <= 0) return 1;

  let bestCols = 1;
  let bestArea = 0;

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const tileW = (width - (cols - 1) * GRID_GAP) / cols;
    const tileH = (height - (rows - 1) * GRID_GAP) / rows;

    if (tileW < MIN_TILE_WIDTH) break;

    const widthConstrained = tileW / tileH <= TILE_ASPECT;
    const w = widthConstrained ? tileW : tileH * TILE_ASPECT;
    const h = widthConstrained ? tileW / TILE_ASPECT : tileH;
    const area = w * h;

    if (area > bestArea) {
      bestArea = area;
      bestCols = cols;
    }
  }

  return bestCols;
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

export const VoiceView = ({
  showVoiceView,
  voiceWidth,
  maxWidth,
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
  maxWidth?: number;
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

  const { poppedOutItems, popout: handlePopout, updatePopoutStream } = usePopoutStreams(gridItems);

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

  const isFocused = !!focusedStream;

  useLayoutEffect(() => {
    onFocusChange?.(isFocused);
  }, [isFocused, onFocusChange]);

  const displayItems = useMemo(() => {
    let items = orderedItems;
    if (focusedStream) {
      items = items.filter((id) => id !== focusedStream.itemId);
    }
    if (poppedOutItems.size > 0) {
      items = items.filter((id) => !poppedOutItems.has(id));
    }
    return items;
  }, [orderedItems, focusedStream, poppedOutItems]);

  const columns = useMemo(
    () => computeOptimalColumns(gridWidth, gridHeight - CONTROLS_HEIGHT, displayItems.length),
    [gridWidth, gridHeight, displayItems.length],
  );

  useEffect(() => {
    if (!focusedStream) return;
    const tracks = focusedStream.stream.getTracks();
    const onEnded = () => {
      if (focusedStream.stream.getTracks().every((t) => t.readyState === "ended")) {
        setFocusedStream(null);
      }
    };
    for (const t of tracks) t.addEventListener("ended", onEnded);
    return () => { for (const t of tracks) t.removeEventListener("ended", onEnded); };
  }, [focusedStream]);

  useEffect(() => {
    if (!focusedStream) return;

    const isScreenTile = focusedStream.itemId.startsWith("screen:");
    const clientId = isScreenTile ? focusedStream.itemId.slice(7) : focusedStream.itemId;
    if (clientId === currentConnectionId) return;

    const client = clientsForHost[clientId];
    if (!client) return;

    const streamKey = isScreenTile
      ? client.screenShareVideoStreamID
      : client.cameraStreamID;
    const currentStream = streamKey ? videoStreams?.[streamKey] : undefined;

    if (currentStream && currentStream !== focusedStream.stream) {
      setFocusedStream((prev) => prev ? { ...prev, stream: currentStream } : null);
    }
  }, [focusedStream, clientsForHost, currentConnectionId, videoStreams]);

  useEffect(() => {
    if (poppedOutItems.size === 0) return;
    for (const itemId of poppedOutItems) {
      const isScreenTile = itemId.startsWith("screen:");
      const clientId = isScreenTile ? itemId.slice(7) : itemId;
      const isSelf = clientId === currentConnectionId;
      const client = clientsForHost[clientId];
      if (!client) continue;

      const currentStream = isScreenTile
        ? (isSelf ? localScreenStream : (client.screenShareVideoStreamID ? videoStreams?.[client.screenShareVideoStreamID] : null))
        : (isSelf ? localCameraStream : (client.cameraStreamID ? videoStreams?.[client.cameraStreamID] : null));

      if (currentStream) {
        updatePopoutStream(itemId, currentStream);
      }
    }
  }, [poppedOutItems, videoStreams, clientsForHost, currentConnectionId, localCameraStream, localScreenStream, updatePopoutStream]);

  const handleFocus = useCallback((info: FocusedStreamInfo) => {
    setFocusedStream((prev) => {
      if (prev?.itemId === info.itemId) return null;
      return info;
    });
  }, []);

  const handleCloseFocus = useCallback(() => {
    setFocusedStream(null);
  }, []);

  const getLatencyStats = (clientId: string, isSelf: boolean) => {
    if (!showPeerLatency) return undefined;
    if (isSelf) {
      return {
        estimatedOneWayMs: selfLatency.estimatedOneWayMs,
        networkRttMs: selfLatency.networkRttMs,
        jitterMs: selfLatency.jitterMs,
        codec: selfLatency.codec,
        remoteAddress: selfLatency.remoteAddress,
      };
    }
    const stats = peerLatency?.[clientId];
    if (!stats) return undefined;
    return {
      estimatedOneWayMs: stats.estimatedOneWayMs,
      networkRttMs: stats.networkRttMs,
      jitterMs: stats.jitterMs,
      codec: stats.codec,
    };
  };

  return (
    <motion.div
      transition={isDragging ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 }}
      animate={{
        width: showVoiceView ? voiceWidth : 0,
        paddingRight: !showVoiceView || voiceWidth === "0px" ? 0 : 8,
      }}
      style={{ overflow: "hidden", maxWidth: maxWidth && maxWidth > 0 ? `${maxWidth}px` : undefined }}
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

          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedItems} strategy={rectSortingStrategy}>
              <div
                style={isFocused ? {
                  display: "flex",
                  gap: "var(--space-2)",
                  overflowX: "auto",
                  overflowY: "hidden",
                  padding: "var(--space-2) 3px 3px",
                  flexShrink: 0,
                } : {
                  display: "grid",
                  gridTemplateColumns: `repeat(${columns}, 1fr)`,
                  gap: "var(--space-2)",
                  justifyItems: "center",
                  alignContent: "center",
                  overflowY: "auto",
                  padding: "3px 3px 60px",
                  height: "100%",
                }}
              >
                <AnimatePresence>
                  {currentServerConnected === serverHost && displayItems.map((itemId) => {
                    const isScreenTile = itemId.startsWith("screen:");
                    const clientId = isScreenTile ? itemId.slice(7) : itemId;
                    const client = clientsForHost[clientId];
                    if (!client) return null;
                    const isSelf = clientId === currentConnectionId;
                    const serverUserId = client?.serverUserId;

                    return (
                      <motion.div
                        key={itemId}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        style={isFocused ? { flexShrink: 0, width: 140 } : { width: "100%" }}
                      >
                        <SortableParticipant id={itemId}>
                          <VoiceParticipantCard
                            itemId={itemId}
                            compact={isFocused}
                            client={client}
                            isSelf={isSelf}
                            isUserConnecting={clientId === currentConnectionId && isConnecting}
                            serverHost={serverHost}
                            avatarFileId={serverUserId ? avatarByServerUserId.get(serverUserId) : undefined}
                            cameraMirrored={cameraMirrored}
                            isSpeaking={clientsSpeaking[clientId]}
                            showPeerLatency={showPeerLatency}
                            latencyStats={getLatencyStats(clientId, isSelf)}
                            localCameraStream={localCameraStream}
                            localScreenStream={localScreenStream}
                            videoStreams={videoStreams}
                            onFocus={handleFocus}
                            onPopout={handlePopout}
                            onDisconnectUser={onDisconnectUser}
                            currentUserRole={currentUserRole}
                            memberInfo={serverUserId ? memberByServerUserId.get(serverUserId) : undefined}
                            adminActions={adminActions}
                          />
                        </SortableParticipant>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </SortableContext>
          </DndContext>

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

        {isFocused && currentServerConnected && (
          <Flex justify="center" py="2" flexShrink="0">
            <Controls onDisconnect={onDisconnect} />
          </Flex>
        )}
      </Flex>
    </motion.div>
  );
};
