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
import { Button, IconButton, Tooltip } from "@gryt/ui";
import type { StreamSources } from "@gryt/voice";
import { useCamera as useLocalCamera, useMicrophone, useScreenShare as useLocalScreenShare, useSFU, useVoiceLatency } from "@gryt/voice";
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
import { PiArrowLineLeftFill, PiArrowLineRightFill, PiChatCircleFill, PiCornersInFill, PiCornersOutFill, PiMicrophoneSlashFill, PiVideoCameraSlashFill } from "react-icons/pi";

import { useSettings } from "@/settings";
import { Controls } from "@/webRTC";

import { useAloneInCall } from "../hooks/useAloneInCall";
import type { PeerLatencyStats } from "../hooks/usePeerLatency";
import { usePopoutStreams } from "../hooks/usePopoutStreams";
import {
  computeGridLayout,
  computeShareLayout,
  GRID_GAP,
  GRID_PADDING,
  gridCapacity,
  PIP_HEIGHT,
  PIP_INSET,
  PIP_RADIUS,
  PIP_WIDTH,
  SHARE_STRIP_MAX_SLOTS,
  tileRadius,
} from "../lib/voiceLayout";
import type { Client } from "../types/clients";
import { FocusedVideoView } from "./FocusedVideoView";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { UserContextMenu } from "./UserContextMenu";
import type { FocusedStreamInfo } from "./VoiceParticipantCard";
import { VoiceParticipantCard } from "./VoiceParticipantCard";

/** A role id. The server defines its own; this only passes one along. */
type Role = string;

// The panel's own chrome: the controls float over the bottom of the grid, and
// a tile running full height would put a name behind the mute button.
const CONTROLS_HEIGHT = 80;

/** Not a client id — the "+N" tile standing in for everyone past the cap. */
const OVERFLOW_ITEM_ID = "overflow:more";

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

/**
 * Detects a microphone that is open but producing nothing at all.
 *
 * This reads the raw analyser deliberately. It is tapped straight off the
 * input, before RNNoise, the gate and muteGain, so muting yourself or sitting
 * behind a closed gate does not look like a dead device.
 *
 * The test is digital silence rather than a low level: a live microphone in a
 * quiet room still has a noise floor, so some bin is non-zero on every frame.
 * All bins reading exactly zero for SILENCE_MS means no samples are arriving —
 * the wrong device is selected, it is muted at the OS level, or it is a
 * loopback device with nothing feeding it. Anything looser than this warns
 * people who are simply not talking, which is worse than not warning at all.
 */
function useSustainedRawSilence(
  analyser: AnalyserNode | undefined,
  enabled: boolean,
): boolean {
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    if (!enabled || !analyser) {
      setSilent(false);
      return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);

    // Long enough that a device still starting up, or a moment of genuine
    // digital silence, does not trip it.
    const SILENCE_MS = 8000;

    let silentSince = 0;
    let reported = false;

    const tick = () => {
      // A suspended context reports all-zero bins too, and that is not the same
      // thing as a dead microphone. Stop measuring rather than accumulate
      // silence we cannot vouch for; useMicrophone resumes it on its own.
      if (analyser.context.state !== "running") {
        silentSince = 0;
        return;
      }

      analyser.getByteFrequencyData(data);

      let hasSignal = false;
      for (let i = 0; i < data.length; i++) {
        if (data[i] > 0) {
          hasSignal = true;
          break;
        }
      }

      const now = performance.now();

      if (hasSignal) {
        silentSince = 0;

        if (reported) {
          reported = false;
          setSilent(false);
        }

        return;
      }

      if (!silentSince) silentSince = now;

      if (!reported && now - silentSince >= SILENCE_MS) {
        reported = true;
        setSilent(true);
      }
    };

    tick();

    const intervalId = window.setInterval(tick, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [analyser, enabled]);

  return silent;
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
    borderRadius: "var(--gryt-radius-lg)",
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
  isCall,
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
  isMaximized,
  onToggleMaximize,
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
  /**
   * This room is a call rather than a voice channel.
   *
   * Decided by the parent, which holds the conversation list, so it is a
   * lookup rather than a guess at the shape of the id. Only a call is ended
   * for having one person left in it — see `useAloneInCall`.
   */
  isCall?: boolean;
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
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
}) => {
  const {
    showPeerLatency,
    cameraMirrored,
    voiceTileLayout,
    voiceTwoPersonLayout,
    setShowSettings,
    setSettingsTab,
  } = useSettings();
  const { latency: selfLatency } = useVoiceLatency(showPeerLatency);

  const {
    screenShareActive: localScreenActive,
    screenVideoStream: localScreenStream,
  } = useLocalScreenShare();

  const {
    cameraStream: localCameraStream,
    cameraError,
    retryCamera,
  } = useLocalCamera();

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
        <div className="flex items-center gap-3">
          <span className="text-sm">
            {reasons[micUnavailable]} — you can hear others, but they cannot
            hear you.
          </span>
          <Button tone="neutral" size="xsmall"
            onClick={() => {
              toast.dismiss(t.id);
              setSettingsTab("sound-video");
              setShowSettings(true);
            }}
          >
            Open settings
          </Button>
        </div>
      ),
      {
        // Fixed id so a reconnect or a re-render cannot stack duplicates.
        id: "mic-unavailable",
        duration: 12000,
        icon: <PiMicrophoneSlashFill size={18} />,
      },
    );
  }, [isInThisVoiceChannel, micUnavailable, setSettingsTab, setShowSettings]);

  // The other half of the same problem. micUnavailable covers a microphone that
  // could not be opened; this covers one that opened fine and produces nothing,
  // which looks completely healthy from the outside. Only worth saying when the
  // device itself is otherwise fine, so it stays quiet while micUnavailable has
  // already spoken.
  const rawInputSilent = useSustainedRawSilence(
    microphoneBuffer.analyser,
    isInThisVoiceChannel && !micUnavailable,
  );

  useEffect(() => {
    if (!rawInputSilent) {
      toast.dismiss("mic-silent");
      return;
    }

    toast(
      (t) => (
        <div className="flex items-center gap-3">
          <span className="text-sm">
            Your microphone is not picking up any sound — others cannot hear
            you. Check the selected device, and that it is not muted.
          </span>
          <Button tone="neutral" size="xsmall"
            onClick={() => {
              toast.dismiss(t.id);
              setSettingsTab("sound-video");
              setShowSettings(true);
            }}
          >
            Open settings
          </Button>
        </div>
      ),
      {
        // Same fixed-id reasoning as above.
        id: "mic-silent",
        duration: 12000,
        icon: <PiMicrophoneSlashFill size={18} />,
      },
    );
  }, [rawInputSilent, setSettingsTab, setShowSettings]);

  /**
   * A camera that would not start used to say nothing at all.
   *
   * `cameraError` has always been set by the engine and read by nobody, so
   * pressing the camera button on a device that refuses gave you a button that
   * turned itself back off and no reason — which reads as the app ignoring you
   * rather than as a failure. The microphone has said this since GRYT-120;
   * this is the camera's version of the same toast (GRYT-16).
   *
   * Not gated on being in a voice channel, unlike the microphone one. This is
   * the direct result of pressing a button, so it should answer wherever it
   * was pressed — including the preview in settings.
   */
  useEffect(() => {
    if (!cameraError) {
      toast.dismiss("camera-unavailable");
      return;
    }

    toast(
      (t) => (
        <div className="flex items-center gap-3">
          <span className="text-sm">{cameraError}</span>
          <Button tone="neutral" size="xsmall"
            onClick={() => {
              toast.dismiss(t.id);
              retryCamera();
            }}
          >
            Try again
          </Button>
          <Button tone="neutral" size="xsmall"
            onClick={() => {
              toast.dismiss(t.id);
              setSettingsTab("sound-video");
              setShowSettings(true);
            }}
          >
            Open settings
          </Button>
        </div>
      ),
      {
        // Same fixed-id reasoning as the microphone toasts above.
        id: "camera-unavailable",
        duration: 12000,
        icon: <PiVideoCameraSlashFill size={18} />,
      },
    );
  }, [cameraError, retryCamera, setSettingsTab, setShowSettings]);

  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Fullscreen is the maximised layout with a different container, so there is
   * no separate layout code — the panel goes fullscreen and the grid's
   * ResizeObserver picks up the new size on its own.
   *
   * State is read back from the document rather than tracked independently,
   * because the browser can leave fullscreen without us: Escape, the window
   * chrome, or another element taking it.
   */
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () =>
      setIsFullscreen(document.fullscreenElement === panelRef.current);

    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void panelRef.current?.requestFullscreen?.().catch((error) => {
      console.warn("[VoiceView] fullscreen refused", error);
    });
  }, []);

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

  /**
   * The other person hung up and nobody is left but you.
   *
   * Counting `visibleClients` rather than working it out again, because the
   * two would drift: this has to mean the same thing as "the panel is drawing
   * one tile", and the tile is what somebody is looking at when it says the
   * call is ending.
   *
   * Not while connecting, when the only tile is your own placeholder.
   */
  const aloneInCall = Boolean(isCall) && !isConnecting && visibleClients.length === 1;

  /**
   * The SFU's own timeout, so the countdown is its clock rather than a copy of
   * its default (GRYT-715). Undefined against an SFU older than that, and the
   * hook falls back.
   */
  const { callAloneTimeoutSeconds, stillHere } = useSFU();

  const { secondsLeft, stay } = useAloneInCall({
    inACall: Boolean(isCall),
    alone: aloneInCall,
    aloneSeconds: callAloneTimeoutSeconds,
    onEnd: () => onDisconnect?.(),
  });

  /**
   * Both clocks, because there are two and they do not talk to each other.
   * `stillHere` restarts the SFU's; `stay` restarts the one drawing this
   * countdown. Missing either leaves a button that looks like it worked.
   */
  const stayInCall = useCallback(() => {
    stillHere?.();
    stay();
  }, [stillHere, stay]);

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

  /**
   * Two people, one big and one in the corner.
   *
   * The default, because it is what a video call usually does and it gives the
   * person you are talking to more pixels. Set to "equal" it falls through to
   * the ordinary grid, which for two tiles stacks them in the sidebar and puts
   * them side by side once there is width for it — the same aspect-ratio rule
   * every other count goes through (GRYT-123).
   */
  const isHeroPip =
    voiceTwoPersonLayout === "hero" &&
    !isFocused &&
    screenItems.length === 0 &&
    peopleItems.length === 2;

  const availableHeight = Math.max(
    0,
    gridHeight - CONTROLS_HEIGHT - GRID_PADDING,
  );
  const usableWidth = Math.max(0, gridWidth - 2 * GRID_PADDING);

  // A share is fitted to its own shape, so the layout needs the stream's real
  // dimensions rather than an assumed 16:9. Meet's share measured 1.731
  // against an intrinsic 1920x1108 — it follows the window being shared.
  const shareAspect = useMemo(() => {
    for (const itemId of screenItems) {
      const clientId = itemId.slice(7);
      const isSelf = clientId === currentConnectionId;
      const stream = isSelf
        ? localScreenStream
        : videoStreams?.[
            clientsForHost[clientId]?.screenShareVideoStreamID ?? ""
          ];
      const settings = stream?.getVideoTracks()[0]?.getSettings();
      if (settings?.width && settings?.height)
        return settings.width / settings.height;
    }
    return 16 / 9;
  }, [
    screenItems,
    currentConnectionId,
    localScreenStream,
    videoStreams,
    clientsForHost,
  ]);

  const shareLayout =
    screenItems.length > 0 && usableWidth > 0 && availableHeight > 0
      ? computeShareLayout(usableWidth, availableHeight, shareAspect)
      : null;

  const gridAreaHeight = shareLayout
    ? shareLayout.participants.height
    : availableHeight;

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
   * How many tiles fit before they stop being readable. A pinned share caps
   * the strip at six slots instead, which is what Meet showed.
   */
  const capacity = useMemo(() => {
    if (shareLayout?.orientation === "strip-above")
      return SHARE_STRIP_MAX_SLOTS;
    return gridCapacity(usableWidth, gridAreaHeight, prioritisedPeople.length);
  }, [
    shareLayout?.orientation,
    usableWidth,
    gridAreaHeight,
    prioritisedPeople.length,
  ]);

  // When everyone does not fit, the last slot becomes the "+N" tile rather
  // than a person, so the count sits inside the layout instead of over it.
  const overflows = prioritisedPeople.length > capacity;

  const visiblePeople = useMemo(
    () =>
      overflows
        ? prioritisedPeople.slice(0, Math.max(1, capacity - 1))
        : prioritisedPeople,
    [overflows, prioritisedPeople, capacity],
  );

  const hiddenCount = prioritisedPeople.length - visiblePeople.length;

  /** What is actually laid out: the visible people, plus the "+N" tile. */
  const laidOutItems = useMemo(
    () =>
      hiddenCount > 0 ? [...visiblePeople, OVERFLOW_ITEM_ID] : visiblePeople,
    [visiblePeople, hiddenCount],
  );

  /**
   * The rows, each with its own tile size.
   *
   * With a share pinned at stage proportions the participants are a single
   * strip whose height is set by the share split, so the grid search does not
   * apply — the tiles just divide the width.
   */
  const gridRows = useMemo(() => {
    if (!laidOutItems.length) return [];

    if (shareLayout?.orientation === "strip-above") {
      const n = laidOutItems.length;
      const height = shareLayout.participants.height;
      return [
        {
          count: n,
          width: (shareLayout.participants.width - (n - 1) * GRID_GAP) / n,
          height,
        },
      ];
    }

    return computeGridLayout(
      usableWidth,
      gridAreaHeight,
      laidOutItems.length,
      voiceTileLayout,
    ).rows;
  }, [laidOutItems, shareLayout, usableWidth, gridAreaHeight, voiceTileLayout]);

  /** The items belonging to each row, in order. */
  const rowItems = useMemo(() => {
    const out: string[][] = [];
    let cursor = 0;
    for (const row of gridRows) {
      out.push(laidOutItems.slice(cursor, cursor + row.count));
      cursor += row.count;
    }
    return out;
  }, [gridRows, laidOutItems]);

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
   * The "+N" tile. Takes a real slot in its row rather than floating over the
   * layout, so the geometry is unchanged. Not sortable — there is no
   * participant behind it to reorder.
   */
  const renderOverflowTile = (size: { width: number; height: number }) => (
    <motion.div
      key={OVERFLOW_ITEM_ID}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{ width: size.width, height: size.height, flexShrink: 0 }}
    >
      <div className="flex items-center justify-center flex-col gap-1" style={{
          width: "100%",
          height: "100%",
          borderRadius: tileRadius(size.height),
          background: "var(--gryt-neutral-4)",
        }}>
        <span className="text-xl font-medium" style={{ color: "var(--gryt-neutral-12)" }}>
          +{hiddenCount}
        </span>
        <span className="text-xs" style={{ color: "var(--gryt-neutral-11)" }}>
          {hiddenCount === 1 ? "other" : "others"}
        </span>
      </div>
    </motion.div>
  );

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
    radius?: number,
    /** Explicit inner box, where the outer style is a container not the tile. */
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
              streamSources={streamSources}
              tileRadius={radius}
            />
          </SortableParticipant>
        </div>
      </motion.div>
    );
  };

  return (
    <motion.div
      data-gryt="voice-view"
      ref={panelRef}
      transition={
        isDragging
          ? { duration: 0 }
          : { type: "spring", stiffness: 300, damping: 30 }
      }
      animate={{
        // Fullscreen sizes the element itself, so an animated pixel width
        // would fight the browser for it.
        width: isFullscreen ? "100%" : showVoiceView ? voiceWidth : 0,
        paddingRight:
          isFullscreen || !showVoiceView || voiceWidth === "0px" ? 0 : 8,
      }}
      style={{
        overflow: "hidden",
        // Focus used to get its own branch here — flexGrow: 1 and no cap — so
        // the panel ate the row the moment a tile was clicked. The width now
        // comes from `voiceWidth` alone, which the parent works out from the
        // voice view's own state, and focus does not touch it (GRYT-110).
        ...(isFullscreen
          ? { height: "100%", maxWidth: "none" }
          : {
              maxWidth:
                maxWidth && maxWidth > 0 ? `${maxWidth}px` : undefined,
            }),
      }}
    >
      <div className="flex h-full w-full flex-col p-3" style={{
          background: "var(--gryt-neutral-3)",
          borderRadius: "var(--gryt-radius-lg)",
        }}>
        {secondsLeft === null ? null : (
          <div
            aria-live="polite"
            className="mb-2 flex items-center justify-between gap-3 rounded px-3 py-2 text-xs"
            style={{
              background: "var(--gryt-neutral-4)",
              color: "var(--gryt-neutral-11)",
            }}
          >
            <span>
              You&rsquo;re the only one here. Ending the call in {secondsLeft}s.
            </span>
            <Button tone="neutral" size="xsmall" onClick={stayInCall}>
              Stay in the call
            </Button>
          </div>
        )}
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
                  serverHost={serverHost}
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
                  onToggleRole={
                    adminActions?.onToggleRole && focusServerUserId
                      ? (role, hold) =>
                          adminActions.onToggleRole!(focusServerUserId, role, hold)
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
                        gap: "8px",
                        overflowX: "auto",
                        overflowY: "hidden",
                        padding: "8px 3px 3px",
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
                    {/* A share sits above the grid at sidebar proportions and
                        below the participant strip at stage proportions — the
                        order flips, which is why the strip renders first. */}
                    {shareLayout?.orientation === "strip-above" && (
                      <div
                        style={{
                          display: "flex",
                          gap: `${GRID_GAP}px`,
                          justifyContent: "center",
                          height: shareLayout.participants.height,
                          flexShrink: 0,
                        }}
                      >
                        <AnimatePresence>
                          {rowItems[0]?.map((itemId) =>
                            itemId === OVERFLOW_ITEM_ID
                              ? renderOverflowTile(gridRows[0])
                              : renderTile(
                                  itemId,
                                  {
                                    width: gridRows[0].width,
                                    height: gridRows[0].height,
                                    flexShrink: 0,
                                  },
                                  tileRadius(gridRows[0].height),
                                ),
                          )}
                        </AnimatePresence>
                      </div>
                    )}

                    {shareLayout && (
                      <div
                        style={{
                          display: "flex",
                          gap: `${GRID_GAP}px`,
                          justifyContent: "center",
                          alignItems: "center",
                          flexShrink: 0,
                          order:
                            shareLayout.orientation === "strip-above" ? 1 : 0,
                          height:
                            shareLayout.orientation === "strip-above"
                              ? undefined
                              : shareLayout.share.height,
                          flexGrow:
                            shareLayout.orientation === "strip-above" ? 1 : 0,
                          minHeight: 0,
                        }}
                      >
                        <AnimatePresence>
                          {screenItems.map((itemId) =>
                            renderTile(itemId, {
                              width: shareLayout.share.width,
                              height: shareLayout.share.height,
                              flexShrink: 0,
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
                          // The hero is a capped, centred tile like any other —
                          // Meet's 847x1136 is the 3:4 cap, not the full area.
                          // The PiP anchors to this box's corner rather than the
                          // hero's, which is why it straddles the hero's bottom
                          // edge when the hero is capped and sits inside it when
                          // the hero fills.
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <AnimatePresence>
                          {(() => {
                            const hero = computeGridLayout(
                              usableWidth,
                              gridAreaHeight,
                              1,
                              voiceTileLayout,
                            ).rows[0];
                            return renderTile(
                              peopleItems[0],
                              {},
                              tileRadius(hero?.height ?? 0),
                              hero,
                            );
                          })()}

                          {renderTile(
                            peopleItems[1],
                            {
                              position: "absolute",
                              right: PIP_INSET,
                              bottom: PIP_INSET,
                              width: PIP_WIDTH,
                              height: PIP_HEIGHT,
                              zIndex: 2,
                            },
                            PIP_RADIUS,
                          )}
                        </AnimatePresence>
                      </div>
                    ) : shareLayout?.orientation === "strip-above" ? null : (
                      <div
                        style={{
                          // Explicit rows. Each row has its own tile size, so
                          // the old widths-sum-to-100% flex-wrap trick no
                          // longer expresses the layout — nine people are a
                          // 293-wide row above a 232-wide one.
                          display: "flex",
                          flexDirection: "column",
                          gap: `${GRID_GAP}px`,
                          alignItems: "center",
                          justifyContent: "center",
                          flex: 1,
                          minHeight: 0,
                          overflow: "hidden",
                        }}
                      >
                        <AnimatePresence>
                          {gridRows.map((row, rowIndex) => (
                            <div
                              key={`row-${rowIndex}`}
                              style={{
                                display: "flex",
                                gap: `${GRID_GAP}px`,
                                justifyContent: "center",
                                height: row.height,
                              }}
                            >
                              {rowItems[rowIndex]?.map((itemId) =>
                                itemId === OVERFLOW_ITEM_ID
                                  ? renderOverflowTile(row)
                                  : renderTile(
                                      itemId,
                                      {
                                        width: row.width,
                                        height: row.height,
                                        flexShrink: 0,
                                      },
                                      tileRadius(row.height),
                                    ),
                              )}
                            </div>
                          ))}
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

                  {onToggleMaximize && (
                    <div className="flex gap-2" style={{
                        position: "absolute",
                        right: 12,
                        bottom: 12,
                        pointerEvents: "auto",
                      }}>
                      <Tooltip
                        title={isFullscreen ? "Leave fullscreen" : "Fullscreen"}
                      >
                        <IconButton tone="neutral" size="xsmall"
                          aria-label={
                            isFullscreen
                              ? "Leave fullscreen"
                              : "Fullscreen voice view"
                          }
                          onClick={toggleFullscreen}
                        >
                          {isFullscreen ? (
                            <PiCornersInFill size={18} />
                          ) : (
                            <PiCornersOutFill size={18} />
                          )}
                        </IconButton>
                      </Tooltip>

                      {/* Nothing to maximise into while the voice view already
                          covers the screen, so the control goes rather than
                          sitting there doing nothing. */}
                      {!isFullscreen && (
                        <Tooltip
                          title={isMaximized ? "Restore" : "Maximize"}
                        >
                          <IconButton tone="neutral" size="xsmall"
                            aria-label={
                              isMaximized
                                ? "Restore voice view"
                                : "Maximize voice view"
                            }
                            onClick={onToggleMaximize}
                          >
                            {isMaximized ? (
                              <PiArrowLineLeftFill size={16} />
                            ) : (
                              <PiArrowLineRightFill size={16} />
                            )}
                          </IconButton>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>

        {isFocused && currentServerConnected && (
          <div className="flex justify-center items-center py-2 shrink-0" style={{ position: "relative" }}>
            <Controls onDisconnect={onDisconnect} />

            {onToggleChat && (
              <div className="flex" style={{ position: "absolute", right: 0 }}>
                <Tooltip
                  title={chatHidden ? "Show chat" : "Hide chat"}
                >
                  <IconButton tone="neutral" size="xsmall"
                    onClick={onToggleChat}
                    style={{ opacity: chatHidden ? 0.5 : 1 }}
                  >
                    <PiChatCircleFill size={16} />
                  </IconButton>
                </Tooltip>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};
