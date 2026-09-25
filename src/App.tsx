import { useSFU } from "@gryt/voice";
import { useCallback, useEffect, useState } from "react";

import { useGlobalHotkeys } from "@/audio";
import {
  capturePendingInviteFromUrl,
  clearPendingInvite,
  normalizeHost,
  type PendingInvite,
  readPendingInvite,
  useAccount,
  writePendingInvite,
} from "@/common";
import {
  AddNewServer,
  PushToTalkModal,
  Settings,
  useSettings,
  useSettingsShortcut,
} from "@/settings";
import { type JoinOutcome, useServerJoin } from "@/settings/src/hooks/useServerJoin";
import {
  DeviceSwitchModal,
  InviteAcceptModal,
  ServerSettingsModal,
  useServerManagement,
} from "@/socket";
import type { InviteJoinRequest } from "@/socket/src/components/InviteAcceptModal";
import { useVoiceSounds } from "@/webRTC";

import { AuthLoadingOverlay } from "./components/AuthLoadingOverlay";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { IdentityClaimPrompt } from "./components/identityClaimPrompt";
import { LeaveServer } from "./components/leaveServer";
import { MainApp } from "./components/mainApp";
import { MicrophoneDebugOverlay } from "./components/microphoneDebugOverlay";
import { ReportDialog } from "./components/reportDialog";
import { TermsPrompt } from "./components/termsPrompt";
import { TrayVoiceState } from "./components/trayVoiceState";
import { VaultUpgradePrompt } from "./components/vaultUpgradePrompt";
import { VideoDebugOverlay } from "./components/videoDebugOverlay";
import { Welcome } from "./components/welcome";

export function App() {
  const { isSignedIn, login, loginInProgress } = useAccount();

  // Waits for Keycloak to settle before mounting: mounting first would let a
  // signed-in person's saved servers reconnect as a guest (GRYT-170).
  const ready = isSignedIn !== undefined;
  const { showAddServer, setShowAddServer, hasServer, switchToServer } =
    useServerManagement();
  const { showDebugOverlay, showVideoDebugOverlay } = useSettings();
  const { join } = useServerJoin();

  useSettingsShortcut();
  const { disconnect } = useSFU();
  const { playDisconnect } = useVoiceSounds();

  const handleHotkeyDisconnect = useCallback(() => {
    // disconnect() no longer takes a playSound argument: the engine does not
    // play anything, so the caller that wanted a sound plays one.
    playDisconnect();
    disconnect();
  }, [disconnect, playDisconnect]);

  useGlobalHotkeys(handleHotkeyDisconnect);

  const [showSplash, setShowSplash] = useState(true);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);

  // Capture invite links early (even before sign-in), then clean the URL.
  useEffect(() => {
    capturePendingInviteFromUrl({ defaultLegacyHost: "app.gryt.chat" });
  }, []);

  // Listen for invite deep links from the Electron main process (gryt://invite?...).
  useEffect(() => {
    return window.electronAPI?.onDeepLinkInvite(({ host, code }) => {
      const pending = writePendingInvite(host, code);
      if (pending) setPendingInvite(pending);
    });
  }, []);

  // Once in the app, show the invite acceptance modal instead of silently adding.
  // Signing in from it comes back here too, since the invite waits in session storage.
  useEffect(() => {
    if (!ready) return;
    const pending = readPendingInvite();
    if (!pending) return;
    setPendingInvite(pending);
  }, [ready]);

  const forgetInvite = useCallback(() => {
    clearPendingInvite();
    setPendingInvite(null);
  }, []);

  // A link's code goes with the join even on an open server, so a role bound to it is still given.
  const handleJoinInvite = useCallback(
    async ({ code, info, note }: InviteJoinRequest): Promise<JoinOutcome> => {
      if (!pendingInvite) return { ok: false, kind: "error", message: "The invite is gone." };
      const outcome = await join({ host: pendingInvite.host, info, inviteCode: code, note });
      if (outcome.ok || outcome.kind === "already_member") forgetInvite();
      return outcome;
    },
    [forgetInvite, join, pendingInvite],
  );

  const alreadyMember = pendingInvite ? hasServer(normalizeHost(pendingInvite.host)) : false;

  const handleGoToServer = useCallback(() => {
    if (!pendingInvite) return;
    switchToServer(normalizeHost(pendingInvite.host));
    forgetInvite();
  }, [forgetInvite, pendingInvite, switchToServer]);

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
          <Welcome />
          <AddNewServer showAddServer={showAddServer} setShowAddServer={setShowAddServer} />
          <LeaveServer />
          <DeviceSwitchModal />
          <ServerSettingsModal />
          <InviteAcceptModal
            invite={pendingInvite}
            alreadyMember={alreadyMember}
            isSignedIn={isSignedIn}
            signingIn={loginInProgress}
            onSignIn={() => void login()}
            onJoin={handleJoinInvite}
            onDismiss={forgetInvite}
            onGoToServer={handleGoToServer}
          />
          <IdentityClaimPrompt />
          <VaultUpgradePrompt />
          <ReportDialog />
          <TermsPrompt />
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
