import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SIDEBAR_WIDTH_PX = 240;
const SIDEBAR_HOVER_PX = 8;
const SIDEBAR_CLOSE_DELAY = 1000;
const VOICE_MIN_WIDTH = 200;
const MIN_CHAT_WIDTH = 200;
const FOCUSED_CHAT_RATIO = 0.25;

interface UseMediaAutoShowParams {
  showVoiceView: boolean;
  setShowVoiceView: (v: boolean) => void;
  isCompact: boolean;
  isConnected: boolean;
  currentChannelId: string;
  serverClients: Record<string, { voiceChannelId?: string; screenShareEnabled?: boolean; cameraEnabled?: boolean }> | undefined;
}

function useMediaAutoShow({
  showVoiceView, setShowVoiceView, isCompact, isConnected,
  currentChannelId, serverClients,
}: UseMediaAutoShowParams) {
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
  isCompact: boolean;
}

function useSidebarHover({ pinChannelsSidebar, pinMembersSidebar, isDraggingResize, isCompact }: UseSidebarHoverParams) {
  const [hoverLeftSidebar, setHoverLeftSidebar] = useState(false);
  const [hoverRightSidebar, setHoverRightSidebar] = useState(false);
  const leftCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rightCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leftSidebarContentRef = useRef<HTMLDivElement>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement>(null);

  const leftSidebarOpen = (!isCompact && pinChannelsSidebar) || hoverLeftSidebar;
  const rightSidebarOpen = (!isCompact && pinMembersSidebar) || hoverRightSidebar;

  const openLeftSidebar = useCallback(() => {
    if (leftCloseTimer.current) { clearTimeout(leftCloseTimer.current); leftCloseTimer.current = null; }
    if (!isDraggingResize) setHoverLeftSidebar(true);
  }, [isDraggingResize]);

  const closeLeftSidebar = useCallback(() => {
    leftCloseTimer.current = setTimeout(() => setHoverLeftSidebar(false), SIDEBAR_CLOSE_DELAY);
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
    openLeftSidebar, closeLeftSidebar,
    openRightSidebar, closeRightSidebar,
  };
}

interface UseVoiceResizeParams {
  voiceWidth: string;
  userVoiceWidth: number;
  setVoiceWidth: (v: string) => void;
  setUserVoiceWidth: (v: number) => void;
  setShowVoiceView: (v: boolean) => void;
}

function useVoiceResize({
  voiceWidth, userVoiceWidth,
  setVoiceWidth, setUserVoiceWidth, setShowVoiceView,
}: UseVoiceResizeParams) {
  const [voiceFocused, setVoiceFocused] = useState(false);
  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);
  const dragMinimizedRef = useRef(false);

  const voiceContainerRef = useRef<HTMLDivElement>(null);
  const [voiceContainerWidth, setVoiceContainerWidth] = useState(0);

  useEffect(() => {
    const el = voiceContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setVoiceContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const voiceMaxWidth = voiceContainerWidth > 0
    ? Math.max(0, voiceContainerWidth - MIN_CHAT_WIDTH)
    : 0;

  const focusedChatWidth = voiceContainerWidth > 0
    ? Math.max(MIN_CHAT_WIDTH, Math.round(voiceContainerWidth * FOCUSED_CHAT_RATIO))
    : MIN_CHAT_WIDTH;
  const focusedVoiceMaxWidth = voiceContainerWidth > 0
    ? Math.max(0, voiceContainerWidth - focusedChatWidth)
    : 0;

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
        const maxW = voiceMaxWidth > 0 ? voiceMaxWidth : Infinity;
        dragMinimizedRef.current = false;
        setVoiceWidth(`${Math.min(rawWidth, maxW)}px`);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDraggingResize(false);
      const rawWidth = dragStartWidth.current + (e.clientX - dragStartX.current);

      if (rawWidth < VOICE_MIN_WIDTH) {
        setShowVoiceView(false);
        setVoiceWidth(`${userVoiceWidth}px`);
      } else {
        const maxW = voiceMaxWidth > 0 ? voiceMaxWidth : Infinity;
        const clamped = Math.min(Math.max(VOICE_MIN_WIDTH, rawWidth), maxW);
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
  }, [isDraggingResize, userVoiceWidth, voiceMaxWidth, setShowVoiceView, setVoiceWidth, setUserVoiceWidth]);

  return {
    voiceFocused, setVoiceFocused,
    isDraggingResize,
    voiceContainerRef, voiceMaxWidth,
    focusedChatWidth, focusedVoiceMaxWidth,
    handleResizeMouseDown,
  };
}

export {
  SIDEBAR_HOVER_PX,
  SIDEBAR_WIDTH_PX,
  useMediaAutoShow,
  useSidebarHover,
  useVoiceResize,
  VOICE_MIN_WIDTH,
};
