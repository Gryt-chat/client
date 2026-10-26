import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VOICE_PRESET_1, type VoiceStop, voiceStopWidth } from "../lib/voiceGrip";

const SIDEBAR_WIDTH_PX = 200;
const SIDEBAR_HOVER_PX = 8;
const SIDEBAR_CLOSE_DELAY = 1000;
// Only says "this server has a call" now; the grip sets the drawn width (lib/voiceGrip.ts).
const VOICE_SIDEBAR_WIDTH = 600;
const MIN_CHAT_WIDTH = 200;

interface UseMediaAutoShowParams {
  showVoiceView: boolean;
  setShowVoiceView: (v: boolean) => void;
  isCompact: boolean;
  /** Whether the window can hold the panel beside a channel list and a chat. */
  roomForVoice: boolean;
  isConnected: boolean;
  currentChannelId: string;
  serverClients: Record<string, { voiceChannelId?: string; screenShareEnabled?: boolean; cameraEnabled?: boolean }> | undefined;
}

function useMediaAutoShow({
  showVoiceView, setShowVoiceView, isCompact, roomForVoice, isConnected,
  currentChannelId, serverClients,
}: UseMediaAutoShowParams) {
  /*
   * The panel gets out of the way when the window cannot hold it: `isCompact` is
   * 1024 and the row needs 1136, so between the two the chat went under.
   */
  const tooNarrow = isCompact || !roomForVoice;
  const compactAutoHiddenRef = useRef(false);
  useEffect(() => {
    if (tooNarrow && showVoiceView) {
      compactAutoHiddenRef.current = true;
      setShowVoiceView(false);
    } else if (!tooNarrow && compactAutoHiddenRef.current) {
      compactAutoHiddenRef.current = false;
      setShowVoiceView(true);
    }
  }, [tooNarrow, setShowVoiceView, showVoiceView]);

  const mediaAutoShownRef = useRef(false);
  const prevAnyMediaActiveRef = useRef(false);

  const anyMediaActive = useMemo(() => {
    if (!serverClients || !currentChannelId || !isConnected) return false;
    return Object.values(serverClients).some(
      (c) => c.voiceChannelId === currentChannelId && (c.screenShareEnabled || c.cameraEnabled),
    );
  }, [serverClients, currentChannelId, isConnected]);

  useEffect(() => {
    if (!isConnected) {
      mediaAutoShownRef.current = false;
      prevAnyMediaActiveRef.current = false;
      return;
    }

    const mediaJustActivated = anyMediaActive && !prevAnyMediaActiveRef.current;
    prevAnyMediaActiveRef.current = anyMediaActive;

    if (mediaJustActivated && !showVoiceView) {
      mediaAutoShownRef.current = true;
      setShowVoiceView(true);
    } else if (!anyMediaActive && showVoiceView && mediaAutoShownRef.current) {
      mediaAutoShownRef.current = false;
      setShowVoiceView(false);
    } else if (!anyMediaActive) {
      mediaAutoShownRef.current = false;
    }
  }, [anyMediaActive, isConnected, showVoiceView, setShowVoiceView]);

  return { mediaAutoShownRef };
}

interface UseSidebarHoverParams {
  pinChannelsSidebar: boolean;
  pinMembersSidebar: boolean;
  isDraggingResize: boolean;
  /**
   * Whether the row can pay for the member list, which depends on the voice
   * panel and not only on the window. See `lib/narrowLayout.ts`.
   */
  roomForMembers: boolean;
}

function useSidebarHover({ pinChannelsSidebar, pinMembersSidebar, isDraggingResize, roomForMembers }: UseSidebarHoverParams) {
  const [hoverLeftSidebar, setHoverLeftSidebar] = useState(false);
  const [hoverRightSidebar, setHoverRightSidebar] = useState(false);
  const leftCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Hidden from inside the list: hovering mustn't reopen it until the pointer has left. */
  const leftHoverHeld = useRef(false);
  const rightCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leftSidebarContentRef = useRef<HTMLDivElement>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement>(null);

  // A narrow window folds the list to icons rather than hiding it (GRYT-1899), so only an unpinned list hides.
  const leftSidebarOpen = pinChannelsSidebar || hoverLeftSidebar;

  /*
   * Hovering is gated too, not just the pin. The member panel is `flexShrink: 0`
   * after a fixed 600px voice panel, so hover pushes it through the right edge.
   */
  const rightSidebarOpen = roomForMembers && (pinMembersSidebar || hoverRightSidebar);

  const openLeftSidebar = useCallback(() => {
    if (leftCloseTimer.current) { clearTimeout(leftCloseTimer.current); leftCloseTimer.current = null; }
    if (!isDraggingResize && !leftHoverHeld.current) setHoverLeftSidebar(true);
  }, [isDraggingResize]);

  const closeLeftSidebar = useCallback(() => {
    leftHoverHeld.current = false;
    leftCloseTimer.current = setTimeout(() => setHoverLeftSidebar(false), SIDEBAR_CLOSE_DELAY);
  }, []);

  const hideLeftSidebarNow = useCallback(() => {
    if (leftCloseTimer.current) { clearTimeout(leftCloseTimer.current); leftCloseTimer.current = null; }
    leftHoverHeld.current = true;
    setHoverLeftSidebar(false);
  }, []);

  const openRightSidebar = useCallback(() => {
    if (rightCloseTimer.current) { clearTimeout(rightCloseTimer.current); rightCloseTimer.current = null; }
    if (!isDraggingResize) setHoverRightSidebar(true);
  }, [isDraggingResize]);

  const closeRightSidebar = useCallback(() => {
    rightCloseTimer.current = setTimeout(() => setHoverRightSidebar(false), SIDEBAR_CLOSE_DELAY);
  }, []);

  useEffect(() => {
    const lt = leftCloseTimer.current;
    const rt = rightCloseTimer.current;
    return () => { if (lt) clearTimeout(lt); if (rt) clearTimeout(rt); };
  }, []);

  useEffect(() => {
    if (leftSidebarOpen) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && leftSidebarContentRef.current?.contains(active)) {
      active.blur();
    }
  }, [leftSidebarOpen]);

  useEffect(() => {
    if (rightSidebarOpen) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && rightSidebarContentRef.current?.contains(active)) {
      active.blur();
    }
  }, [rightSidebarOpen]);

  return {
    leftSidebarOpen, rightSidebarOpen,
    leftSidebarContentRef, rightSidebarContentRef,
    openLeftSidebar, closeLeftSidebar, hideLeftSidebarNow,
    openRightSidebar, closeRightSidebar,
  };
}

interface UseVoiceLayoutParams {
  setShowVoiceView: (v: boolean) => void;
}

/** The voice view's size: hidden is `showVoiceView === false`, otherwise a width or full. Not persisted. */
function useVoiceLayout({ setShowVoiceView }: UseVoiceLayoutParams) {
  const [voiceFocused, setVoiceFocused] = useState(false);
  const [voiceSize, setVoiceSize] = useState<Exclude<VoiceStop, "hidden">>(VOICE_PRESET_1);
  const isMaximized = voiceSize === "full";

  // A callback ref: the middle area mounts after the first render, so an effect on a plain ref never observed it.
  const voiceContainerRef = useRef<HTMLDivElement | null>(null);
  const [voiceContainer, setVoiceContainer] = useState<HTMLDivElement | null>(null);
  const attachVoiceContainer = useCallback((el: HTMLDivElement | null) => {
    voiceContainerRef.current = el;
    setVoiceContainer(el);
  }, []);
  const [voiceContainerWidth, setVoiceContainerWidth] = useState(0);

  useEffect(() => {
    if (!voiceContainer) return;
    const ro = new ResizeObserver(([entry]) => {
      setVoiceContainerWidth(entry.contentRect.width);
    });
    ro.observe(voiceContainer);
    return () => ro.disconnect();
  }, [voiceContainer]);

  const voiceMaxWidth = voiceContainerWidth > 0
    ? Math.max(0, voiceContainerWidth - MIN_CHAT_WIDTH)
    : 0;

  // Stops are the panel's visible width; the view's 16px right padding is the gap to the chat.
  const chosenWidth = (voiceStopWidth(voiceSize, voiceContainerWidth) ?? VOICE_PRESET_1) + 16;
  const shownVoiceWidth = voiceMaxWidth > 0 ? Math.min(chosenWidth, voiceMaxWidth) : chosenWidth;

  const setVoiceStop = useCallback((stop: VoiceStop) => {
    if (stop === "hidden") {
      setShowVoiceView(false);
      return;
    }
    setVoiceSize(stop);
    setShowVoiceView(true);
  }, [setShowVoiceView]);

  return {
    voiceFocused, setVoiceFocused,
    isMaximized, voiceSize, setVoiceStop, voiceContainerWidth,
    voiceContainerRef, attachVoiceContainer, voiceMaxWidth, shownVoiceWidth,
  };
}

export {
  SIDEBAR_HOVER_PX,
  SIDEBAR_WIDTH_PX,
  useMediaAutoShow,
  useSidebarHover,
  useVoiceLayout,
  VOICE_SIDEBAR_WIDTH,
};
