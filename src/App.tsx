import { useCallback, useEffect, useState } from "react";

import { useGlobalHotkeys } from "@/audio";
import { capturePendingInviteFromUrl, clearPendingInvite, type PendingInvite, readPendingInvite, useAccount } from "@/common";
import { AddNewServer, Nickname, PushToTalkModal, Settings, useSettings } from "@/settings";
import { SignUpModal } from "@/signUp";
import { DeviceSwitchModal, InviteAcceptModal, ServerSettingsModal, useServerManagement } from "@/socket";
import { useSFU } from "@/webRTC";

import { AuthLoadingOverlay } from "./components/AuthLoadingOverlay";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LeaveServer } from "./components/leaveServer";
import { MainApp } from "./components/mainApp";
import { MicrophoneDebugOverlay } from "./components/microphoneDebugOverlay";
import { Welcome } from "./components/welcome";

export function App() {
  const { isSignedIn } = useAccount();
  const { showAddServer, setShowAddServer, addServer } = useServerManagement();
  const { showDebugOverlay } = useSettings();
  const { disconnect } = useSFU();

  const handleHotkeyDisconnect = useCallback(() => {
    disconnect(true);
  }, [disconnect]);

  useGlobalHotkeys(handleHotkeyDisconnect);

  const [showSplash, setShowSplash] = useState(true);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);

  // Capture invite links early (even before sign-in), then clean the URL.
  useEffect(() => {
    capturePendingInviteFromUrl({ defaultLegacyHost: "app.gryt.chat" });
  }, []);

  // After sign-in, show the invite acceptance modal instead of silently adding.
  useEffect(() => {
    if (!isSignedIn) return;
    const pending = readPendingInvite();
    if (!pending) return;
    setPendingInvite(pending);
  }, [isSignedIn]);

  const handleAcceptInvite = useCallback(() => {
    if (!pendingInvite) return;
    addServer({ host: pendingInvite.host, name: pendingInvite.host, token: pendingInvite.code }, true);
    clearPendingInvite();
    setPendingInvite(null);
  }, [addServer, pendingInvite]);

  const handleDismissInvite = useCallback(() => {
    clearPendingInvite();
    setPendingInvite(null);
  }, []);

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
          <InviteAcceptModal invite={pendingInvite} onAccept={handleAcceptInvite} onDismiss={handleDismissInvite} />
          <PushToTalkModal />
          <MicrophoneDebugOverlay isVisible={showDebugOverlay} />
        </>
      ) : (
        <SignUpModal />
      )}

      <AuthLoadingOverlay open={showSplash} />
    </ErrorBoundary>
  );
}
