import { useSFU } from "@gryt/voice";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { fetchServerInfo, type JoinOutcome, useServerJoin } from "@/settings/src/hooks/useServerJoin";
import {
  DeviceSwitchModal,
  InviteAcceptModal,
  ServerSettingsModal,
  useServerManagement,
} from "@/socket";
import { FriendRequestDialog } from "@/socket/src/components/FriendRequestDialog";
import type { InviteJoinRequest } from "@/socket/src/components/InviteAcceptModal";
import { useVoiceSounds } from "@/webRTC";

import { ApproveDeviceDialog } from "./components/approveDevice";
import { AuthLoadingOverlay } from "./components/AuthLoadingOverlay";
import { CallStatsRecorder } from "./components/callStatsRecorder";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GameDetectPrompt } from "./components/gameDetectPrompt";
import { GlobalLightbox } from "./components/GlobalLightbox";
import { IdentityClaimPrompt } from "./components/identityClaimPrompt";
import { LeaveServer } from "./components/leaveServer";
import { LinkDeviceDialog } from "./components/linkDevice";
import { MainApp } from "./components/mainApp";
import { MainIdentity } from "./components/MainIdentity";
import { MicrophoneDebugOverlay } from "./components/microphoneDebugOverlay";
import { ReportDialog } from "./components/reportDialog";
import { SaveWordsDialog } from "./components/saveWordsDialog";
import { SignInApproval } from "./components/signInApproval";
import { TermsPrompt } from "./components/termsPrompt";
import { TrayVoiceState } from "./components/trayVoiceState";
import { VaultUpgradePrompt } from "./components/vaultUpgradePrompt";
import { VideoDebugOverlay } from "./components/videoDebugOverlay";
import { Welcome } from "./components/welcome";
import { offerSharedLook } from "./lib/sharedLook";
import { useCloudServerSync } from "./lib/useCloudServerSync";
import { cloudWait } from "./packages/settings/src/cloudWait";
import { markCloudWelcome } from "./packages/socket/src/lib/cloudWelcomeFlag";

export function App() {
  const { isSignedIn, login, loginInProgress } = useAccount();

  // Waits for Keycloak to settle before mounting: mounting first would let a
  // signed-in person's saved servers reconnect as a guest (GRYT-170).
  const ready = isSignedIn !== undefined;
  const { showAddServer, setShowAddServer, hasServer, switchToServer } =
    useServerManagement();
  const { showDebugOverlay, showVideoDebugOverlay, openSettings } = useSettings();
  const { join } = useServerJoin();

  useSettingsShortcut();
  useCloudServerSync();
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

  // A shared card or owl (gryt://card, gryt://owl) opens the settings page that shows it before it's used.
  useEffect(() => {
    return window.electronAPI?.onDeepLinkLook?.((look) => {
      offerSharedLook(look);
      openSettings(look.card ? "card" : "profile");
    });
  }, [openSettings]);

  // Read through a ref, since the deep-link listener is registered once.
  const openKnown = useRef({ hasServer, switchToServer });
  useEffect(() => {
    openKnown.current = { hasServer, switchToServer };
  }, [hasServer, switchToServer]);

  // Listen for invite deep links from the Electron main process (gryt://invite?...).
  useEffect(() => {
    return window.electronAPI?.onDeepLinkInvite(({ host, code, welcome }) => {
      if (welcome) markCloudWelcome(host);
      if (cloudWait.take(host)) return;
      // A server this device already has opens, rather than offering to join it again.
      if (openKnown.current.hasServer(normalizeHost(host))) return openKnown.current.switchToServer(normalizeHost(host));
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
    const host = normalizeHost(pending.host);
    if (openKnown.current.hasServer(host)) {
      clearPendingInvite();
      openKnown.current.switchToServer(host);
      return;
    }
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

  // A link with no code, signed in: try the join first, so an owner or an open server never sees the dialog.
  const [tryingHost, setTryingHost] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingInvite || pendingInvite.code || !isSignedIn || alreadyMember) return;
    const host = pendingInvite.host;
    setTryingHost(host);
    void (async () => {
      const info = await fetchServerInfo(host);
      const outcome = info.kind === "info" ? await join({ host, info: info.info }) : null;
      if (outcome?.ok) forgetInvite();
      setTryingHost(null);
    })();
  }, [pendingInvite, isSignedIn, alreadyMember, join, forgetInvite]);

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
          <LinkDeviceDialog />
          <SaveWordsDialog />
          <SignInApproval />
          <FriendRequestDialog />
          <ApproveDeviceDialog />
          <AddNewServer showAddServer={showAddServer} setShowAddServer={setShowAddServer} />
          <LeaveServer />
          <DeviceSwitchModal />
          <ServerSettingsModal />
          <InviteAcceptModal
            invite={tryingHost ? null : pendingInvite}
            alreadyMember={alreadyMember}
            isSignedIn={isSignedIn}
            signingIn={loginInProgress}
            onSignIn={() => void login()}
            onJoin={handleJoinInvite}
            onDismiss={forgetInvite}
            onGoToServer={handleGoToServer}
          />
          <IdentityClaimPrompt />
          <MainIdentity />
          <VaultUpgradePrompt />
          <GameDetectPrompt />
          <GlobalLightbox />
          <ReportDialog />
          <TermsPrompt />
          <PushToTalkModal />
          <TrayVoiceState />
          <CallStatsRecorder />
          <MicrophoneDebugOverlay isVisible={showDebugOverlay} />
          <VideoDebugOverlay isVisible={showVideoDebugOverlay} />
        </>
      )}

      <AuthLoadingOverlay open={showSplash} />
    </ErrorBoundary>
  );
}
