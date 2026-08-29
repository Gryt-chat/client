import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SIDEBAR_WIDTH_PX = 240;
const SIDEBAR_HOVER_PX = 8;
const SIDEBAR_CLOSE_DELAY = 1000;
// GRYT-40's "Shown" state: one fixed sidebar width, no drag handle. A freely
// resizable panel meant the grid had to work at every width and was tuned for
// none of them. 600 is what the Meet layout was checked against, and the point
// where a third column starts winning on tile area at nine or more people —
// below about 540 a tall narrow panel always prefers two.
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
   * The panel gets out of the way when the window cannot hold it, and comes
   * back when it can.
   *
   * `isCompact` alone was not enough. It is 1024, and the row needs 1136 for a
   * rail, a channel list, the 600px panel and a chat at its 200px minimum —
   * so between those two the panel stayed at 600, the chat was squeezed under
   * its own minimum (measured at 118px in a 1030px window) and the row ran
   * past the right edge of the window. The clamp inside `useVoiceLayout`
   * cannot catch that: it measures a container that has already grown to hold
   * the panel.
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
  isCompact: boolean;
  /**
   * Whether the row can pay for the member list, which depends on the voice
   * panel and not only on the window. See `lib/narrowLayout.ts`.
   */
  roomForMembers: boolean;
}

function useSidebarHover({ pinChannelsSidebar, pinMembersSidebar, isDraggingResize, isCompact, roomForMembers }: UseSidebarHoverParams) {
  const [hoverLeftSidebar, setHoverLeftSidebar] = useState(false);
  const [hoverRightSidebar, setHoverRightSidebar] = useState(false);
  const leftCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rightCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const leftSidebarContentRef = useRef<HTMLDivElement>(null);
  const rightSidebarContentRef = useRef<HTMLDivElement>(null);

  const leftSidebarOpen = (!isCompact && pinChannelsSidebar) || hoverLeftSidebar;

  /*
   * Hovering is gated too, not just the pin.
   *
   * The left sidebar can be opened at any width because the chat gives way for
   * it — `minWidth: 0` and it shrinks. The member panel is `flexShrink: 0` and
   * sits after a voice panel that is a fixed 600, so when the row cannot pay
   * for it, opening it on hover puts it through the right edge of the window
   * exactly the way pinning it did. Same rule for both ways of opening it.
   */
  const rightSidebarOpen = roomForMembers && (pinMembersSidebar || hoverRightSidebar);

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

interface UseVoiceLayoutParams {
  setShowVoiceView: (v: boolean) => void;
}

/**
 * The voice view's layout state.
 *
 * Three of GRYT-40's four states: minimized is `showVoiceView === false`,
 * shown is the fixed sidebar width, maximized fills the row and hides the
 * chat. Fullscreen is not here yet.
 *
 * Neither state is persisted, so maximizing lasts as long as the view does.
 * Whether it should be remembered per channel, per server or globally is one
 * of GRYT-40's open questions and is deliberately not guessed at here.
 */
function useVoiceLayout({ setShowVoiceView }: UseVoiceLayoutParams) {
  const [voiceFocused, setVoiceFocused] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

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

  // The sidebar width, unless the window is too narrow to leave the chat a
  // usable column — then the chat's minimum wins and the panel gives way.
  const shownVoiceWidth = voiceMaxWidth > 0
    ? Math.min(VOICE_SIDEBAR_WIDTH, voiceMaxWidth)
    : VOICE_SIDEBAR_WIDTH;

  const toggleMaximized = useCallback(() => {
    // Maximizing while minimized would grow something invisible. Reading the
    // current value here rather than inside the updater keeps the updater
    // pure — it used to call setShowVoiceView from inside one.
    if (!isMaximized) setShowVoiceView(true);
    setIsMaximized(!isMaximized);
  }, [isMaximized, setShowVoiceView]);

  return {
    voiceFocused, setVoiceFocused,
    isMaximized, toggleMaximized,
    voiceContainerRef, voiceMaxWidth, shownVoiceWidth,
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
