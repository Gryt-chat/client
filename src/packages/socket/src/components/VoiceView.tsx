import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { MdChat, MdMicOff } from "react-icons/md";

import {
  useCamera as useLocalCamera,
  useMicrophone,
  useScreenShare as useLocalScreenShare,
  useVoiceLatency,
} from "@/audio";
import { useSettings } from "@/settings";
import { Controls } from "@/webRTC";
import type { StreamSources } from "@/webRTC/src/types/SFU";

import type { PeerLatencyStats } from "../hooks/usePeerLatency";
import { usePopoutStreams } from "../hooks/usePopoutStreams";
import type { Client } from "../types/clients";
import { FocusedVideoView } from "./FocusedVideoView";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { UserContextMenu } from "./UserContextMenu";
import type { FocusedStreamInfo } from "./VoiceParticipantCard";
import { TILE_RADIUS, VoiceParticipantCard } from "./VoiceParticipantCard";

type Role = "owner" | "admin" | "mod" | "member";

// Measured off Google Meet at a phone-width viewport: 16px around the grid,
// 12px between tiles. Four tiles landed at exactly (16,73) (256,73) (16,381)
// (256,381), which pins both numbers rather than approximating them.
const GRID_GAP = 12;
const GRID_PADDING = 16;
const MIN_TILE_WIDTH = 140;
const CONTROLS_HEIGHT = 80;

// A screen share is pinned full-width above the participants rather than
// taking a cell in the grid. Confirmed from reference screenshots — share + 2
// gives a full-width share over two stacked tiles, share + 4 gives share over a
// 2x2.
//
// The region is sized to the share's own shape rather than to a flat fraction
// of the panel. A fixed fraction looked reasonable until it was rendered: in a
// sidebar-width panel a 60%-tall box is far taller than a 16:9 share, so
// object-fit contain letterboxed it into a band with black above and below,
// and the height it wasted came straight out of the participants' tiles. The
// cap is what stops a wide panel from handing the share the whole view.
const SCREEN_SHARE_ASPECT = 16 / 9;
const SCREEN_SHARE_MAX_HEIGHT_FRACTION = 0.6;

// Two participants and no share is hero + picture-in-picture: one tile fills
// the panel, the second overlaps its bottom-right corner. Genuinely
// special-cased — the grid rules on their own would just stack them.
//
// The inset and radius are measured; the PiP's own size is not, so it is a
// fraction of the panel clamped to something recognisable at either extreme.
const PIP_INSET = 16;
const PIP_RADIUS = 12;
const PIP_WIDTH_FRACTION = 0.32;
// Same floor as a grid tile: below this a tile is too small to recognise
// anyone in, and in a sidebar-width panel the fraction lands under it.
const PIP_MIN_WIDTH = MIN_TILE_WIDTH;
const PIP_MAX_WIDTH = 220;

/**
 * How square a tile is allowed to get before it stops stretching.
 *
 * Measured off Meet on 2026-08-07, from six screenshots at phone width. Two of
 * them pin these numbers exactly:
 *
 * - Four people and no share: four tiles at 1.791, and each one 713 wide inside
 *   an 847-wide container. Meet capped the tile at 16:9 and gave the leftover
 *   back as centring rather than stretching it.
 * - A share plus four people: 0.741 and 0.719, sitting on the portrait cap.
 *
 * Cases where neither cap binds came out at 1.395 and 1.534, so the range is
 * real and not two separate fixed shapes.
 *
 * This replaces an earlier note that Meet caps at 4:3. It does not — the
 * landscape cap is 16:9. The earlier no-cap rule is what made a tall narrow
 * panel stack everyone into one column of letterboxes.
 */
const MIN_TILE_ASPECT = 3 / 4;
const MAX_TILE_ASPECT = 16 / 9;

// Below this the grid stops adding tiles and collects the rest behind a count.
// It is the same height at which VoiceParticipantCard has to shrink the avatar
// and drop the latency figure to fit — past there a tile is a coloured smear
// with a name on it, and ten of those are worse than nine and a number.
//
// Deriving the cap from a height rather than fixing a participant count means
// it moves with the panel: about ten in the sidebar, six once a share is
// pinned and takes half the height, far more when the panel is maximised.
const MIN_READABLE_TILE_HEIGHT = 110;

/** Not a client id — the "+N" tile that stands in for everyone past the cap. */
const OVERFLOW_ITEM_ID = "overflow:more";

/**
 * The tile inside a cell of this size: the cell's own shape, clamped into the
 * allowed range, then fitted. Whatever is left over becomes centring.
 */
function fitTile(
  cellWidth: number,
  cellHeight: number,
): { width: number; height: number } {
  if (cellWidth <= 0 || cellHeight <= 0) return { width: 0, height: 0 };

  const aspect = Math.min(
    MAX_TILE_ASPECT,
    Math.max(MIN_TILE_ASPECT, cellWidth / cellHeight),
  );

  const height = Math.min(cellHeight, cellWidth / aspect);

  return { width: height * aspect, height };
}

/**
 * Column count that gives the largest tiles.
 *
 * Scores the *capped* tile, not the cell. That distinction is the whole
 * behaviour: a 340px sidebar splitting seven people into one column gives cells
 * of 308x90, which cap down to a 160x90 sliver, while two columns give 148x166
 * uncapped. Scoring cells picks the column; scoring tiles picks the grid, which
 * is what Meet does and what the screenshots show.
 *
 * MIN_TILE_WIDTH still stops the search: past that point tiles are too small to
 * recognise anyone in, and packing more columns in is worse than not.
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
    const cellW = (width - (cols - 1) * GRID_GAP) / cols;
    const cellH = (height - (rows - 1) * GRID_GAP) / rows;

    if (cellW < MIN_TILE_WIDTH) break;
    if (cellH <= 0) continue;

    const { width: tileW, height: tileH } = fitTile(cellW, cellH);

    const area = tileW * tileH;

    if (area > bestArea) {
      bestArea = area;
      bestCols = cols;
    }
  }

  return bestCols;
}

/**
 * How many tiles sit in each row, given a column count.
 *
 * Rows come out as even as possible and any remainder lands in the *later*
 * rows, so a short row is always at the top. Measured off Meet: three
 * participants render as one tile above two, five as two above three, and seven
 * as 2 / 2 / 3.
 *
 * Seven is the case that matters — with only two rows "remainder first" and
 * "remainder last" are indistinguishable, which is why three and five alone
 * were misleading.
 */
function distributeRows(count: number, columns: number): number[] {
  if (count <= 0 || columns <= 0) return [];

  const rows = Math.ceil(count / columns);
  const base = Math.floor(count / rows);
  const withExtra = count % rows;

  return Array.from({ length: rows }, (_, i) =>
    i >= rows - withExtra ? base + 1 : base,
  );
}

/**
 * Local speaking detector based on the final processed audio analyser.
 *
 * This must read microphoneBuffer.finalAnalyser, not the raw analyser,
 * so the ring reflects what is actually sent after RNNoise, AGC,
 * compressor, noise gate, mute, and final processing.
 */
function useFinalProcessedSpeaking(
  finalAnalyser: AnalyserNode | undefined,
  enabled: boolean,
): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!enabled || !finalAnalyser) {
      setSpeaking(false);
      return;
    }

    const data = new Uint8Array(finalAnalyser.frequencyBinCount);

    let lastSpeaking = false;
    let silenceSince = 0;

    const SPEAKING_THRESHOLD = 8;
    const RELEASE_MS = 180;

    const tick = () => {
      finalAnalyser.getByteFrequencyData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i] * data[i];
      }

      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      const aboveThreshold = rms >= SPEAKING_THRESHOLD;

      if (aboveThreshold) {
        silenceSince = 0;

        if (!lastSpeaking) {
          lastSpeaking = true;
          setSpeaking(true);
        }

        return;
      }

      if (!lastSpeaking) return;

      if (!silenceSince) silenceSince = now;

      if (now - silenceSince >= RELEASE_MS) {
        lastSpeaking = false;
        setSpeaking(false);
      }
    };

    tick();

    const intervalId = window.setInterval(tick, 50);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [finalAnalyser, enabled]);

  return speaking;
}

function SortableParticipant({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    zIndex: isDragging ? 10 : undefined,
    cursor: isDragging ? "grabbing" : "grab",
    borderRadius: "var(--radius-5)",
    boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.35)" : undefined,
    // Fill whatever the parent allots. Without this the card underneath sizes
    // against an auto-width box instead of its grid cell.
    width: "100%",
    height: "100%",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

function hasLiveVideoTrack(stream: MediaStream | undefined | null): boolean {
  if (!stream) return false;

  return stream.getVideoTracks().some((track) => track.readyState === "live");
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
  chatHidden,
  onToggleChat,
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
  chatHidden?: boolean;
  onToggleChat?: () => void;
}) => {
  const { showPeerLatency, cameraMirrored, setShowSettings, setSettingsTab } =
    useSettings();
  const { latency: selfLatency } = useVoiceLatency(showPeerLatency);

  const {
    screenShareActive: localScreenActive,
    screenVideoStream: localScreenStream,
  } = useLocalScreenShare();

  const { cameraStream: localCameraStream } = useLocalCamera();

  const { microphoneBuffer, micUnavailable } = useMicrophone(false);

  const isInThisVoiceChannel =
    currentServerConnected === serverHost && !!currentConnectionId;

  const localProcessedSpeaking = useFinalProcessedSpeaking(
    microphoneBuffer.finalAnalyser,
    isInThisVoiceChannel,
  );

  // Joining without a microphone is allowed on purpose — listening is useful on
  // its own — but it used to look completely normal, so you could sit in a
  // channel believing you were audible. Say it once, and point at the fix.
  const warnedAboutMicRef = useRef(false);

  useEffect(() => {
    if (!isInThisVoiceChannel || !micUnavailable) {
      warnedAboutMicRef.current = false;
      return;
    }

    if (warnedAboutMicRef.current) return;
    warnedAboutMicRef.current = true;

    const reasons: Record<typeof micUnavailable, string> = {
      denied: "Microphone access is blocked",
      "no-device": "No microphone found",
      failed: "Your microphone could not be started",
    };

    toast(
      (t) => (
        <Flex align="center" gap="3">
          <Text size="2">
            {reasons[micUnavailable]} — you can hear others, but they cannot
            hear you.
          </Text>
          <Button
            size="1"
            variant="soft"
            onClick={() => {
              toast.dismiss(t.id);
              setSettingsTab("sound-video");
              setShowSettings(true);
            }}
          >
            Open settings
          </Button>
        </Flex>
      ),
      {
        // Fixed id so a reconnect or a re-render cannot stack duplicates.
        id: "mic-unavailable",
        duration: 12000,
        icon: <MdMicOff size={18} />,
      },
    );
  }, [isInThisVoiceChannel, micUnavailable, setSettingsTab, setShowSettings]);

  const gridRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState(0);
  const [gridWidth, setGridWidth] = useState(0);
  const [focusedStream, setFocusedStream] = useState<FocusedStreamInfo | null>(
    null,
  );

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const memberByServerUserId = new Map(
    (members || []).map((m) => [m.serverUserId, m]),
  );

  const avatarByServerUserId = new Map<string, string | null | undefined>(
    (members || []).map((m) => [m.serverUserId, m.avatarFileId]),
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
  }, [
    clientsForHost,
    currentServerConnected,
    serverHost,
    currentConnectionId,
    isConnecting,
    currentChannelId,
  ]);

  const fallbackCameraStreamIdByClientId = useMemo(() => {
    const result: Record<string, string> = {};

    if (!videoStreams || currentServerConnected !== serverHost) return result;

    const allVideoStreamIds = Object.keys(videoStreams).sort();
    const claimedVideoStreamIds = new Set<string>();

    for (const id of visibleClients) {
      const client = clientsForHost[id];
      if (!client) continue;

      if (client.cameraStreamID) {
        claimedVideoStreamIds.add(client.cameraStreamID);
      }

      if (client.screenShareVideoStreamID) {
        claimedVideoStreamIds.add(client.screenShareVideoStreamID);
      }
    }

    const unclaimedLiveVideoStreamIds = allVideoStreamIds.filter((streamId) => {
      if (claimedVideoStreamIds.has(streamId)) return false;

      const stream = videoStreams[streamId];
      return hasLiveVideoTrack(stream);
    });

    const remoteCameraClientsMissingStream = visibleClients
      .filter((id) => id !== currentConnectionId)
      .filter((id) => {
        const client = clientsForHost[id];
        if (!client) return false;

        const advertisedStreamWorks =
          client.cameraStreamID &&
          hasLiveVideoTrack(videoStreams[client.cameraStreamID]);

        return Boolean(client.cameraEnabled && !advertisedStreamWorks);
      })
      .sort();

    for (
      let i = 0;
      i < remoteCameraClientsMissingStream.length &&
      i < unclaimedLiveVideoStreamIds.length;
      i++
    ) {
      result[remoteCameraClientsMissingStream[i]] =
        unclaimedLiveVideoStreamIds[i];
    }

    if (Object.keys(result).length > 0) {
      console.warn("[VoiceView] Assigned fallback camera streams", {
        fallbackCameraStreamIdByClientId: result,
        videoStreamKeys: allVideoStreamIds,
        claimedVideoStreamIds: [...claimedVideoStreamIds],
      });
    }

    return result;
  }, [
    videoStreams,
    visibleClients,
    clientsForHost,
    currentConnectionId,
    currentServerConnected,
    serverHost,
  ]);

  const gridItems = useMemo(() => {
    const items: string[] = [];

    for (const id of visibleClients) {
      const client = clientsForHost[id];
      const isSelf = id === currentConnectionId;

      items.push(id);

      if (isSelf && localScreenActive && localScreenStream) {
        items.push(`screen:${id}`);
      } else if (
        !isSelf &&
        client.screenShareEnabled &&
        client.screenShareVideoStreamID
      ) {
        items.push(`screen:${id}`);

        console.log(
          `[ScreenShare] gridItems: added screen:${id} (streamID=${
            client.screenShareVideoStreamID
          }, inVideoStreams=${!!videoStreams?.[client.screenShareVideoStreamID]})`,
        );
      }
    }

    return items;
  }, [
    visibleClients,
    clientsForHost,
    currentConnectionId,
    localScreenActive,
    localScreenStream,
    videoStreams,
  ]);

  const {
    poppedOutItems,
    popout: handlePopout,
    updatePopoutStream,
  } = usePopoutStreams(gridItems, streamSources);

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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = orderedItems.indexOf(String(active.id));
        const newIndex = orderedItems.indexOf(String(over.id));

        if (oldIndex !== -1 && newIndex !== -1) {
          setCustomOrder(arrayMove(orderedItems, oldIndex, newIndex));
        }
      }
    },
    [orderedItems],
  );

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

  useEffect(() => {
    if (!showVoiceView) setFocusedStream(null);
  }, [showVoiceView]);

  useEffect(() => {
    if (focusedStream && !gridItems.includes(focusedStream.itemId)) {
      setFocusedStream(null);
    }
  }, [focusedStream, gridItems]);

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

  // A screen share is pinned full-width above the participants, so it is not
  // one of the tiles the grid has to place.
  const screenItems = useMemo(
    () => displayItems.filter((id) => id.startsWith("screen:")),
    [displayItems],
  );

  const peopleItems = useMemo(
    () => displayItems.filter((id) => !id.startsWith("screen:")),
    [displayItems],
  );

  const isHeroPip =
    !isFocused && screenItems.length === 0 && peopleItems.length === 2;

  // How tall the pinned share region ends up: its own shape at the width it
  // gets, capped so a wide panel does not hand it everything. Shares sit side
  // by side, so each is a fraction of the width and the row gets shorter.
  const availableHeight = Math.max(
    0,
    gridHeight - CONTROLS_HEIGHT - GRID_PADDING,
  );
  const usableWidth = Math.max(0, gridWidth - 2 * GRID_PADDING);
  const shareWidth =
    screenItems.length > 0
      ? (usableWidth - (screenItems.length - 1) * GRID_GAP) / screenItems.length
      : 0;
  const shareHeight =
    screenItems.length > 0
      ? Math.min(
          shareWidth / SCREEN_SHARE_ASPECT,
          availableHeight * SCREEN_SHARE_MAX_HEIGHT_FRACTION,
        )
      : 0;

  // What is left for the participant grid once the controls and any pinned
  // share have taken their share of the panel.
  const gridAreaHeight = Math.max(
    0,
    availableHeight - (shareHeight > 0 ? shareHeight + GRID_GAP : 0),
  );

  /**
   * Who keeps a tile when there is not room for everyone.
   *
   * Anyone with a camera or a screen share outranks a plain avatar tile: an
   * avatar is the same information the member list already gives you, video is
   * not. Sorting is stable, so within a rank the existing order — including a
   * manual drag — is preserved. Dragging across ranks does not stick, which is
   * the cost of ranking at all.
   */
  const prioritisedPeople = useMemo(() => {
    const rank = (itemId: string) => {
      const client = clientsForHost[itemId];
      if (!client) return 2;
      return client.cameraEnabled || client.screenShareEnabled ? 0 : 1;
    };

    return [...peopleItems].sort((a, b) => rank(a) - rank(b));
  }, [peopleItems, clientsForHost]);

  /**
   * How many tiles fit before they stop being readable.
   *
   * Walks the counts rather than solving for one, because the column count
   * changes underneath as the count grows and the tile size is not monotonic
   * across those jumps. Thirty is well past any real voice channel and keeps
   * this from scanning a silly range.
   */
  const gridCapacity = useMemo(() => {
    if (usableWidth <= 0 || gridAreaHeight <= 0)
      return prioritisedPeople.length;

    let capacity = 1;

    for (let k = 1; k <= Math.min(prioritisedPeople.length, 30); k++) {
      const cols = computeOptimalColumns(usableWidth, gridAreaHeight, k);
      const rows = Math.ceil(k / cols);
      const { height } = fitTile(
        (usableWidth - (cols - 1) * GRID_GAP) / cols,
        (gridAreaHeight - (rows - 1) * GRID_GAP) / rows,
      );

      if (height >= MIN_READABLE_TILE_HEIGHT) capacity = k;
    }

    return capacity;
  }, [usableWidth, gridAreaHeight, prioritisedPeople.length]);

  // When everyone does not fit, the last cell becomes the "+N" tile rather than
  // a person, so the count is inside the grid instead of floating over it.
  const overflowsGrid = prioritisedPeople.length > gridCapacity;

  const visiblePeople = useMemo(
    () =>
      overflowsGrid
        ? prioritisedPeople.slice(0, Math.max(1, gridCapacity - 1))
        : prioritisedPeople,
    [overflowsGrid, prioritisedPeople, gridCapacity],
  );

  const hiddenCount = prioritisedPeople.length - visiblePeople.length;

  /** What the grid actually lays out: the visible people, plus the "+N" tile. */
  const gridItemsToLay = useMemo(
    () =>
      hiddenCount > 0 ? [...visiblePeople, OVERFLOW_ITEM_ID] : visiblePeople,
    [visiblePeople, hiddenCount],
  );

  const columns = useMemo(
    () =>
      computeOptimalColumns(usableWidth, gridAreaHeight, gridItemsToLay.length),
    [usableWidth, gridAreaHeight, gridItemsToLay.length],
  );

  /**
   * The tiles for each row, so a row holding fewer than `columns` tiles can
   * stretch them across its full width rather than leaving a gap. Three
   * participants become one wide tile above two, which is what Meet does and
   * what a plain `repeat(columns, 1fr)` grid cannot express.
   */
  const tileLayout = useMemo(() => {
    const perRow = distributeRows(gridItemsToLay.length, columns);
    const map = new Map<string, { inRow: number; rowCount: number }>();
    let cursor = 0;

    perRow.forEach((n) => {
      for (let i = 0; i < n; i++) {
        map.set(gridItemsToLay[cursor + i], {
          inRow: n,
          rowCount: perRow.length,
        });
      }
      cursor += n;
    });

    return map;
  }, [gridItemsToLay, columns]);

  useEffect(() => {
    if (!focusedStream) return;

    const tracks = focusedStream.stream.getTracks();

    const onEnded = () => {
      if (
        focusedStream.stream.getTracks().every((t) => t.readyState === "ended")
      ) {
        setFocusedStream(null);
      }
    };

    for (const t of tracks) t.addEventListener("ended", onEnded);

    return () => {
      for (const t of tracks) t.removeEventListener("ended", onEnded);
    };
  }, [focusedStream]);

  useEffect(() => {
    if (!focusedStream) return;

    const isScreenTile = focusedStream.itemId.startsWith("screen:");
    const clientId = isScreenTile
      ? focusedStream.itemId.slice(7)
      : focusedStream.itemId;

    if (clientId === currentConnectionId) return;

    const client = clientsForHost[clientId];
    if (!client) return;

    const fallbackCameraStreamID = fallbackCameraStreamIdByClientId[clientId];

    const streamKey = isScreenTile
      ? client.screenShareVideoStreamID
      : client.cameraStreamID || fallbackCameraStreamID;

    const currentStream = streamKey ? videoStreams?.[streamKey] : undefined;

    const latestAudioStreamId = isScreenTile
      ? client.screenShareAudioStreamID || undefined
      : focusedStream.audioStreamId;

    const streamChanged =
      currentStream && currentStream !== focusedStream.stream;
    const audioIdChanged = latestAudioStreamId !== focusedStream.audioStreamId;

    if (streamChanged || audioIdChanged) {
      setFocusedStream((prev) => {
        if (!prev) return null;

        return {
          ...prev,
          ...(streamChanged ? { stream: currentStream! } : {}),
          ...(audioIdChanged ? { audioStreamId: latestAudioStreamId } : {}),
        };
      });
    }
  }, [
    focusedStream,
    clientsForHost,
    currentConnectionId,
    videoStreams,
    fallbackCameraStreamIdByClientId,
  ]);

  useEffect(() => {
    if (poppedOutItems.size === 0) return;

    for (const itemId of poppedOutItems) {
      const isScreenTile = itemId.startsWith("screen:");
      const clientId = isScreenTile ? itemId.slice(7) : itemId;
      const isSelf = clientId === currentConnectionId;
      const client = clientsForHost[clientId];

      if (!client) continue;

      const fallbackCameraStreamID = fallbackCameraStreamIdByClientId[clientId];

      const currentStream = isScreenTile
        ? isSelf
          ? localScreenStream
          : client.screenShareVideoStreamID
            ? videoStreams?.[client.screenShareVideoStreamID]
            : null
        : isSelf
          ? localCameraStream
          : client.cameraStreamID && videoStreams?.[client.cameraStreamID]
            ? videoStreams[client.cameraStreamID]
            : fallbackCameraStreamID && videoStreams?.[fallbackCameraStreamID]
              ? videoStreams[fallbackCameraStreamID]
              : null;

      if (currentStream) {
        updatePopoutStream(itemId, currentStream);
      }
    }
  }, [
    poppedOutItems,
    videoStreams,
    clientsForHost,
    currentConnectionId,
    localCameraStream,
    localScreenStream,
    fallbackCameraStreamIdByClientId,
    updatePopoutStream,
  ]);

  const handleFocus = useCallback((info: FocusedStreamInfo) => {
    setFocusedStream((prev) => {
      if (prev?.itemId === info.itemId) return null;
      return info;
    });
  }, []);

  const handleCloseFocus = useCallback(() => {
    setFocusedStream(null);
  }, []);

  const handleFocusedPopout = useCallback(() => {
    if (!focusedStream) return;

    handlePopout(
      focusedStream.itemId,
      focusedStream.stream,
      focusedStream.title,
      focusedStream.audioStreamId,
    );

    setFocusedStream(null);
  }, [focusedStream, handlePopout]);

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

  /**
   * A tile's cell in the wrapping grid.
   *
   * Sized from the row this tile belongs to, so a row holding fewer tiles than
   * `columns` gets a wider cell each — three participants are one wide cell
   * above two. Widths summing to 100% are what make flex-wrap break the rows in
   * the right places, so no row wrappers are needed and the drag-and-drop
   * context stays flat.
   *
   * The cell is not the tile. The tile is the capped box centred inside it —
   * see `gridTileSize`.
   */
  const gridCellStyle = (itemId: string): CSSProperties => {
    const l = tileLayout.get(itemId) ?? { inRow: 1, rowCount: 1 };

    return {
      width: `calc((100% - ${(l.inRow - 1) * GRID_GAP}px) / ${l.inRow})`,
      height: `calc((100% - ${(l.rowCount - 1) * GRID_GAP}px) / ${l.rowCount})`,
      minWidth: 0,
      minHeight: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    };
  };

  /**
   * The tile itself: the cell's shape clamped into the allowed aspect range.
   *
   * Computed in pixels from the same measured `usableWidth` the column search
   * used, rather than in percentages, because the clamp is not expressible as
   * one. Any leftover in the cell shows up as centring, which is what Meet does
   * — four people at phone width are four 16:9 tiles with a margin either side,
   * not four full-width letterboxes.
   */
  const gridTileSize = (itemId: string): { width: number; height: number } => {
    const l = tileLayout.get(itemId) ?? { inRow: 1, rowCount: 1 };

    return fitTile(
      (usableWidth - (l.inRow - 1) * GRID_GAP) / l.inRow,
      (gridAreaHeight - (l.rowCount - 1) * GRID_GAP) / l.rowCount,
    );
  };

  /**
   * The "+N" tile. Takes a real cell so the grid geometry is unchanged — it is
   * the last tile rather than something layered over the last row.
   *
   * Not sortable and not in the DndContext: there is no participant behind it
   * to reorder.
   */
  const renderOverflowTile = () => {
    const size = gridTileSize(OVERFLOW_ITEM_ID);

    return (
      <motion.div
        key={OVERFLOW_ITEM_ID}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        style={gridCellStyle(OVERFLOW_ITEM_ID)}
      >
        <Flex
          align="center"
          justify="center"
          direction="column"
          gap="1"
          style={{
            width: size.width,
            height: size.height,
            borderRadius: TILE_RADIUS,
            background: "var(--gray-4)",
          }}
        >
          <Text size="5" weight="medium" style={{ color: "var(--gray-12)" }}>
            +{hiddenCount}
          </Text>
          <Text size="1" style={{ color: "var(--gray-11)" }}>
            {hiddenCount === 1 ? "other" : "others"}
          </Text>
        </Flex>
      </motion.div>
    );
  };

  /**
   * One tile, positioned by whatever box the region it lives in hands it.
   *
   * The regions differ — a pinned share, the hero, the PiP, a grid cell — but
   * the card and its drag wrapper are identical in all of them, so only the
   * outer box varies.
   */
  const renderTile = (
    itemId: string,
    style: CSSProperties,
    tileRadius?: number,
    /** Capped tile inside the cell. Omitted where the box is the tile. */
    tileSize?: { width: number; height: number },
  ) => {
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
        style={style}
      >
        <div
          style={
            tileSize
              ? { width: tileSize.width, height: tileSize.height }
              : { width: "100%", height: "100%" }
          }
        >
          <SortableParticipant id={itemId}>
            <VoiceParticipantCard
              itemId={itemId}
              compact={isFocused}
              client={client}
              isSelf={isSelf}
              isUserConnecting={
                clientId === currentConnectionId && isConnecting
              }
              serverHost={serverHost}
              avatarFileId={
                serverUserId
                  ? avatarByServerUserId.get(serverUserId)
                  : undefined
              }
              cameraMirrored={cameraMirrored}
              isSpeaking={
                isSelf ? localProcessedSpeaking : !!clientsSpeaking[clientId]
              }
              showPeerLatency={showPeerLatency}
              latencyStats={getLatencyStats(clientId, isSelf)}
              localCameraStream={localCameraStream}
              localScreenStream={localScreenStream}
              videoStreams={videoStreams}
              fallbackCameraStreamID={
                fallbackCameraStreamIdByClientId[clientId] || null
              }
              onFocus={handleFocus}
              onPopout={handlePopout}
              onDisconnectUser={onDisconnectUser}
              currentUserRole={currentUserRole}
              memberInfo={
                serverUserId
                  ? memberByServerUserId.get(serverUserId)
                  : undefined
              }
              adminActions={adminActions}
              tileRadius={tileRadius}
            />
          </SortableParticipant>
        </div>
      </motion.div>
    );
  };

  return (
    <motion.div
      data-gryt="voice-view"
      transition={
        isDragging
          ? { duration: 0 }
          : { type: "spring", stiffness: 300, damping: 30 }
      }
      animate={{
        width: showVoiceView ? voiceWidth : 0,
        paddingRight: !showVoiceView || voiceWidth === "0px" ? 0 : 8,
      }}
      style={{
        overflow: "hidden",
        ...(isFocused && showVoiceView
          ? { flexGrow: 1, minWidth: 0 }
          : {
              maxWidth: maxWidth && maxWidth > 0 ? `${maxWidth}px` : undefined,
            }),
      }}
    >
      <Flex
        style={{
          background: "var(--gray-3)",
          borderRadius: "var(--radius-5)",
        }}
        height="100%"
        width="100%"
        direction="column"
        p="3"
      >
        <div
          ref={gridRef}
          style={{
            flexGrow: 1,
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {isFocused &&
            (() => {
              const isScreenTile = focusedStream.itemId.startsWith("screen:");
              const focusClientId = isScreenTile
                ? focusedStream.itemId.slice(7)
                : focusedStream.itemId;
              const focusClient = clientsForHost[focusClientId];
              const focusIsSelf = focusClientId === currentConnectionId;
              const focusServerUserId = focusClient?.serverUserId;
              const focusMember = focusServerUserId
                ? memberByServerUserId.get(focusServerUserId)
                : undefined;

              const focusedView = (
                <FocusedVideoView
                  stream={focusedStream.stream}
                  title={focusedStream.title}
                  audioStreamId={focusedStream.audioStreamId}
                  streamSources={streamSources}
                  objectFit={focusedStream.objectFit}
                  mirrored={focusedStream.mirrored}
                  onClose={handleCloseFocus}
                  onPopout={handleFocusedPopout}
                />
              );

              if (!focusClient) return focusedView;

              return (
                <UserContextMenu
                  serverUserId={focusServerUserId}
                  nickname={focusClient.nickname}
                  isSelf={focusIsSelf}
                  canDisconnect={!!onDisconnectUser}
                  isInVoice={true}
                  onDisconnectFromVoice={
                    onDisconnectUser && focusServerUserId
                      ? () => onDisconnectUser(focusServerUserId)
                      : undefined
                  }
                  role={currentUserRole}
                  targetRole={focusMember?.role}
                  isServerMuted={focusMember?.isServerMuted}
                  isServerDeafened={focusMember?.isServerDeafened}
                  onKick={
                    adminActions?.onKickUser && focusServerUserId
                      ? () => adminActions.onKickUser!(focusServerUserId)
                      : undefined
                  }
                  onBan={
                    adminActions?.onBanUser && focusServerUserId
                      ? () => adminActions.onBanUser!(focusServerUserId)
                      : undefined
                  }
                  onServerMute={
                    adminActions?.onServerMuteUser && focusServerUserId
                      ? (muted) =>
                          adminActions.onServerMuteUser!(
                            focusServerUserId,
                            muted,
                          )
                      : undefined
                  }
                  onServerDeafen={
                    adminActions?.onServerDeafenUser && focusServerUserId
                      ? (deafened) =>
                          adminActions.onServerDeafenUser!(
                            focusServerUserId,
                            deafened,
                          )
                      : undefined
                  }
                  onChangeRole={
                    adminActions?.onChangeRole && focusServerUserId
                      ? (role) =>
                          adminActions.onChangeRole!(focusServerUserId, role)
                      : undefined
                  }
                  onPopoutVideo={handleFocusedPopout}
                >
                  {focusedView}
                </UserContextMenu>
              );
            })()}

          <DndContext
            sensors={dndSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedItems}
              strategy={rectSortingStrategy}
            >
              <div
                style={
                  isFocused
                    ? {
                        display: "flex",
                        gap: "var(--space-2)",
                        overflowX: "auto",
                        overflowY: "hidden",
                        padding: "var(--space-2) 3px 3px",
                        flexShrink: 0,
                      }
                    : {
                        // Two stacked regions: any pinned screen share on top,
                        // the participants below.
                        display: "flex",
                        flexDirection: "column",
                        gap: `${GRID_GAP}px`,
                        // Extra room at the bottom: the controls float over
                        // this area, and a tile running full height puts the
                        // participant's name behind the mute button.
                        padding: `${GRID_PADDING}px ${GRID_PADDING}px ${CONTROLS_HEIGHT}px`,
                        height: "100%",
                        overflow: "hidden",
                      }
                }
              >
                {currentServerConnected !== serverHost ? null : isFocused ? (
                  <AnimatePresence>
                    {displayItems.map((itemId) =>
                      renderTile(itemId, { flexShrink: 0, width: 140 }),
                    )}
                  </AnimatePresence>
                ) : (
                  <>
                    {screenItems.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          gap: `${GRID_GAP}px`,
                          height: shareHeight,
                          flexShrink: 0,
                        }}
                      >
                        <AnimatePresence>
                          {screenItems.map((itemId) =>
                            renderTile(itemId, {
                              flex: 1,
                              minWidth: 0,
                              height: "100%",
                            }),
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {isHeroPip ? (
                      <div
                        style={{
                          position: "relative",
                          flex: 1,
                          minHeight: 0,
                          // The hero is capped and centred like any other tile
                          // — Meet's measured 847x1136 is the 3:4 cap, not the
                          // full area. The PiP then anchors to this box's
                          // corner rather than the hero's, which is why it
                          // straddles the hero's bottom edge in the reference.
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <AnimatePresence>
                          {renderTile(
                            peopleItems[0],
                            {},
                            undefined,
                            fitTile(usableWidth, gridAreaHeight),
                          )}

                          {renderTile(
                            peopleItems[1],
                            {
                              position: "absolute",
                              right: PIP_INSET,
                              bottom: PIP_INSET,
                              width: `${PIP_WIDTH_FRACTION * 100}%`,
                              minWidth: PIP_MIN_WIDTH,
                              maxWidth: PIP_MAX_WIDTH,
                              aspectRatio: "16 / 9",
                              zIndex: 2,
                            },
                            PIP_RADIUS,
                          )}
                        </AnimatePresence>
                      </div>
                    ) : (
                      <div
                        style={{
                          // Rows are laid out by wrapping rather than as one
                          // grid, because a row holding fewer tiles than
                          // `columns` has to stretch them across its full
                          // width. Three participants are one wide tile above
                          // two, which repeat(columns, 1fr) cannot express.
                          display: "flex",
                          flexWrap: "wrap",
                          alignContent: "flex-start",
                          gap: `${GRID_GAP}px`,
                          flex: 1,
                          minHeight: 0,
                          overflow: "hidden",
                        }}
                      >
                        <AnimatePresence>
                          {gridItemsToLay.map((itemId) =>
                            itemId === OVERFLOW_ITEM_ID
                              ? renderOverflowTile()
                              : renderTile(
                                  itemId,
                                  gridCellStyle(itemId),
                                  undefined,
                                  gridTileSize(itemId),
                                ),
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </>
                )}
              </div>
            </SortableContext>
          </DndContext>

          {!isFocused && (
            <AnimatePresence>
              {currentServerConnected && (
                <motion.div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
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
          <Flex
            justify="center"
            align="center"
            py="2"
            flexShrink="0"
            style={{ position: "relative" }}
          >
            <Controls onDisconnect={onDisconnect} />

            {onToggleChat && (
              <Flex style={{ position: "absolute", right: 0 }}>
                <Tooltip
                  content={chatHidden ? "Show chat" : "Hide chat"}
                  delayDuration={300}
                >
                  <IconButton
                    variant="soft"
                    color="gray"
                    onClick={onToggleChat}
                    style={{ opacity: chatHidden ? 0.5 : 1 }}
                  >
                    <MdChat size={16} />
                  </IconButton>
                </Tooltip>
              </Flex>
            )}
          </Flex>
        )}
      </Flex>
    </motion.div>
  );
};
