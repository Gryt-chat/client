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
import {
  AddNewServer,
  Nickname,
  PushToTalkModal,
  Settings,
  useSettings,
  useSettingsShortcut,
} from "@/settings";
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
import { TrayVoiceState } from "./components/trayVoiceState";
import { VideoDebugOverlay } from "./components/videoDebugOverlay";
import { Welcome } from "./components/welcome";

export function App() {
  const { isSignedIn } = useAccount();

  // Nobody is asked to choose. You arrive as an identity held on this device,
  // and signing in is something you do later from settings if you want a
  // durable account — at which point the servers you already joined come with
  // you (GRYT-170). `isSignedIn` still gates nothing; it only decides what a
  // server is told about you at the moment you join one.
  //
  // Still waits for Keycloak to settle before mounting. It resolves to false
  // quickly when there is no session, and mounting first would let a signed-in
  // person's saved servers reconnect as a guest before their account was known.
  const ready = isSignedIn !== undefined;
  const { showAddServer, setShowAddServer, addServer, hasServer, switchToServer } =
    useServerManagement();
  const { nickname, showDebugOverlay, showVideoDebugOverlay } = useSettings();

  useSettingsShortcut();
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

  // Once in the app, show the invite acceptance modal instead of silently
  // adding. Follows whichever way you got here — an invite link is just as
  // likely to be the reason somebody opened Gryt without an account.
  useEffect(() => {
    if (!ready) return;
    const pending = readPendingInvite();
    if (!pending) return;
    setPendingInvite(pending);
    setInviteJoinState({ joining: false, error: "" });
  }, [ready]);

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
      {!ready ? null : (
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
          <TrayVoiceState />
          <MicrophoneDebugOverlay isVisible={showDebugOverlay} />
          <VideoDebugOverlay isVisible={showVideoDebugOverlay} />
        </>
      )}

      <AuthLoadingOverlay open={showSplash} />
    </ErrorBoundary>
  );
}
