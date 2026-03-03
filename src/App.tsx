import { useCallback, useEffect, useState } from "react";

import { useGlobalHotkeys } from "@/audio";
import {
  capturePendingInviteFromUrl,
  clearPendingInvite,
  normalizeCode,
  normalizeHost,
  type PendingInvite,
  readPendingInvite,
  setServerAccessToken,
  setServerRefreshToken,
  useAccount,
  writePendingInvite,
} from "@/common";
import { AddNewServer, Nickname, PushToTalkModal, Settings, useSettings } from "@/settings";
import { SignUpModal } from "@/signUp";
import {
  DeviceSwitchModal,
  InviteAcceptModal,
  joinServerOnce,
  ServerSettingsModal,
  useServerManagement,
} from "@/socket";
import { useSFU } from "@/webRTC";

import { AuthLoadingOverlay } from "./components/AuthLoadingOverlay";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LeaveServer } from "./components/leaveServer";
import { MainApp } from "./components/mainApp";
import { MicrophoneDebugOverlay } from "./components/microphoneDebugOverlay";
import { VideoDebugOverlay } from "./components/videoDebugOverlay";
import { Welcome } from "./components/welcome";

export function App() {
  const { isSignedIn } = useAccount();
  const { showAddServer, setShowAddServer, addServer, hasServer, switchToServer } =
    useServerManagement();
  const { nickname, showDebugOverlay, showVideoDebugOverlay } = useSettings();
  const { disconnect } = useSFU();

  const handleHotkeyDisconnect = useCallback(() => {
    disconnect(true);
  }, [disconnect]);

  useGlobalHotkeys(handleHotkeyDisconnect);

  const [showSplash, setShowSplash] = useState(true);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [inviteJoinState, setInviteJoinState] = useState<{ joining: boolean; error: string }>({
    joining: false,
    error: "",
  });

  // Capture invite links early (even before sign-in), then clean the URL.
  useEffect(() => {
    capturePendingInviteFromUrl({ defaultLegacyHost: "app.gryt.chat" });
  }, []);

  // Listen for invite deep links from the Electron main process (gryt://invite?...).
  useEffect(() => {
    return window.electronAPI?.onDeepLinkInvite(({ host, code }) => {
      const pending = writePendingInvite(host, code);
      if (pending) {
        setPendingInvite(pending);
        setInviteJoinState({ joining: false, error: "" });
      }
    });
  }, []);

  // After sign-in, show the invite acceptance modal instead of silently adding.
  useEffect(() => {
    if (!isSignedIn) return;
    const pending = readPendingInvite();
    if (!pending) return;
    setPendingInvite(pending);
    setInviteJoinState({ joining: false, error: "" });
  }, [isSignedIn]);

  const handleAcceptInvite = useCallback(() => {
    if (!pendingInvite) return;
    if (inviteJoinState.joining) return;

    void (async () => {
      const host = normalizeHost(pendingInvite.host);
      const code = normalizeCode(pendingInvite.code);
      if (!host || !code) return;

      setInviteJoinState({ joining: true, error: "" });

      const result = await joinServerOnce({
        host,
        nickname,
        inviteCode: code,
      });
      // Note: we don't persist invite codes; we just use it for the initial join.

      if (!result.ok) {
        const message =
          result.error.message ||
          (result.error.error === "invalid_invite"
            ? "Invalid invite code."
            : result.error.error === "invite_rate_limited" || result.error.error === "rate_limited"
              ? "Too many attempts. Please wait and try again."
              : `Failed to join server: ${result.error.error}`);
        setInviteJoinState({ joining: false, error: message });
        return;
      }

      setServerAccessToken(host, result.joinInfo.accessToken);
      if (result.joinInfo.refreshToken) setServerRefreshToken(host, result.joinInfo.refreshToken);

      addServer({ host, name: host }, true);
      clearPendingInvite();
      setPendingInvite(null);
      setInviteJoinState({ joining: false, error: "" });
    })();
  }, [addServer, inviteJoinState.joining, nickname, pendingInvite]);

  const handleDismissInvite = useCallback(() => {
    if (inviteJoinState.joining) return;
    clearPendingInvite();
    setPendingInvite(null);
    setInviteJoinState({ joining: false, error: "" });
  }, [inviteJoinState.joining]);

  const alreadyMember = pendingInvite ? hasServer(normalizeHost(pendingInvite.host)) : false;

  const handleGoToServer = useCallback(() => {
    if (!pendingInvite) return;
    switchToServer(normalizeHost(pendingInvite.host));
    clearPendingInvite();
    setPendingInvite(null);
    setInviteJoinState({ joining: false, error: "" });
  }, [pendingInvite, switchToServer]);

  useEffect(() => {
    if (isSignedIn === undefined) {
      setShowSplash(true);
      return;
    }
    // Allow the app UI to mount behind, then fade the overlay out.
    setShowSplash(false);
  }, [isSignedIn]);

  return (
    <ErrorBoundary>
      {isSignedIn === undefined ? null : isSignedIn ? (
        <>
          <MainApp />
          <Settings />
          <Nickname />
          <Welcome />
          <AddNewServer showAddServer={showAddServer} setShowAddServer={setShowAddServer} />
          <LeaveServer />
          <DeviceSwitchModal />
          <ServerSettingsModal />
          <InviteAcceptModal
            invite={pendingInvite}
            joinError={inviteJoinState.error}
            joining={inviteJoinState.joining}
            alreadyMember={alreadyMember}
            onAccept={handleAcceptInvite}
            onDismiss={handleDismissInvite}
            onGoToServer={handleGoToServer}
          />
          <PushToTalkModal />
          <MicrophoneDebugOverlay isVisible={showDebugOverlay} />
          <VideoDebugOverlay isVisible={showVideoDebugOverlay} />
        </>
      ) : (
        <SignUpModal />
      )}

      <AuthLoadingOverlay open={showSplash} />
    </ErrorBoundary>
  );
}
