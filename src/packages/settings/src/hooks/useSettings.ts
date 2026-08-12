import { useEffect, useRef, useState } from "react";

import { singletonHook } from "@/common";
import {
  clearStoredAvatar,
  getStoredAvatar,
  setStoredAvatar,
  useUserId,
} from "@/common";

import type { VoiceTileLayout } from "./settingsStorage";
import { type ScalabilityMode, type ScreenShareCodec, settingsInit, type VideoCodec } from "./settingsStorage";
import { loadAudioFromCache, useAudioSettings } from "./useAudioSettings";
import { getUserValue, loadForUser, setUserValue } from "./userStorage";

function useSettingsHook() {
  const userId = useUserId();
  const audio = useAudioSettings();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("profile");
  const [showNickname, setShowNickname] = useState(false);
  const [hasSeenWelcome, setHasSeenWelcome] = useState(false);
  /**
   * Whether the stored settings have actually been read yet.
   *
   * Everything below defaults to something, and until the load has run those
   * defaults are guesses rather than answers. That is fine for most of them,
   * and wrong for anything that decides whether to show a first-run thing:
   * `hasSeenWelcome` defaults to false, so without this the app is briefly
   * certain that everybody is new.
   *
   * The window is not small. `useUserId` holds `userId` at null until Keycloak
   * answers, on purpose, so the effect below does not even start until a
   * network round trip has finished.
   */
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showTour, setShowTour] = useState(false);

  const avatarObjectUrlRef = useRef<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrlState] = useState<string | null>(null);

  /**
   * Whether settings show everything or only what most people need.
   *
   * Off by default, and off is the honest default: the panel had grown to the
   * point where the essential controls sat between debug overlays and things
   * nobody should touch without a reason. Turning it on reveals the rest in
   * place rather than moving anything, so a setting somebody has been shown
   * before does not wander off.
   */
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [showVideoDebugOverlay, setShowVideoDebugOverlay] = useState(false);
  const [nickname, setNickname] = useState("Unknown");
  const [showPeerLatency, setShowPeerLatency] = useState(true);
  const [chatMediaVolume, setChatMediaVolume] = useState(50);
  const [blurProfanity, setBlurProfanityState] = useState(true);
  const [smileyConversion, setSmileyConversionState] = useState(true);
  const [disabledSmileys, setDisabledSmileysState] = useState<ReadonlySet<string>>(new Set());

  const [cameraID, setCameraID] = useState("");
  const [cameraQuality, setCameraQuality] = useState("native");
  const [cameraMirrored, setCameraMirrored] = useState(true);
  const [faceFramingEnabled, setFaceFramingEnabled] = useState(false);
  const [voiceTileLayout, setVoiceTileLayout] =
    useState<VoiceTileLayout>("meet");
  const [devFakeParticipants, setDevFakeParticipants] = useState(0);
  const [devFakeMembers, setDevFakeMembers] = useState(0);
  const [devFakeChatSeconds, setDevFakeChatSeconds] = useState(6);
  const [devFakeMuted, setDevFakeMuted] = useState(0);
  const [devFakeScreenShare, setDevFakeScreenShare] = useState(false);
  const [devFakeDeafened, setDevFakeDeafened] = useState(false);
  const [devFakeSpeaking, setDevFakeSpeaking] = useState(true);
  const [cameraFlipped, setCameraFlipped] = useState(false);
  const [cameraFps, setCameraFpsState] = useState(30);
  const [cameraCodec, setCameraCodecState] = useState<VideoCodec>("auto");

  const [screenShareQuality, setScreenShareQuality] = useState("native");
  const [screenShareFps, setScreenShareFps] = useState(30);
  const [experimentalScreenShare, setExperimentalScreenShare] = useState(false);
  const [screenShareGamingMode, setScreenShareGamingModeState] = useState(true);
  const [screenShareCodec, setScreenShareCodecState] = useState<ScreenShareCodec>("auto");
  const [screenShareMaxBitrate, setScreenShareMaxBitrateState] = useState(0);
  const [screenShareScalabilityMode, setScreenShareScalabilityModeState] = useState<ScalabilityMode>("L1T3");

  const [userVolumes, setUserVolumes] = useState<Record<string, number>>({});
  const [showVoiceView, setShowVoiceView] = useState(true);

  const [pinChannelsSidebar, setPinChannelsSidebarState] = useState(true);
  const [pinMembersSidebar, setPinMembersSidebarState] = useState(true);

  const [isAFK, setIsAFK] = useState(false);
  const [afkTimeoutMinutes, setAfkTimeoutMinutes] = useState(5);

  const applyAudioRef = useRef(audio.applyAudioData);
  applyAudioRef.current = audio.applyAudioData;

  // Load user-specific settings when userId changes
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      await loadForUser(userId);
      if (cancelled) return;

      applyAudioRef.current(loadAudioFromCache());

      setNickname(getUserValue("nickname", "Unknown"));
      setHasSeenWelcome(getUserValue("hasSeenWelcome", false));
      setShowAdvanced(getUserValue("showAdvanced", false));
      setShowDebugOverlay(getUserValue("showDebugOverlay", false));
      setShowVideoDebugOverlay(getUserValue("showVideoDebugOverlay", false));
      setShowPeerLatency(getUserValue("showPeerLatency", true));
      setChatMediaVolume(getUserValue("chatMediaVolume", 50));
      setBlurProfanityState(getUserValue("blurProfanity", true));
      setSmileyConversionState(getUserValue("smileyConversion", true));
      setDisabledSmileysState(new Set(getUserValue<string[]>("disabledSmileys", [])));
      setCameraID(getUserValue("cameraID", ""));
      setCameraQuality(getUserValue("cameraQuality", "native"));
      setCameraMirrored(getUserValue("cameraMirrored", true));
      setFaceFramingEnabled(getUserValue("faceFramingEnabled", false));
      setVoiceTileLayout(
        getUserValue<VoiceTileLayout>("voiceTileLayout", "meet"),
      );
      setDevFakeParticipants(getUserValue("devFakeParticipants", 0));
      setDevFakeMembers(getUserValue("devFakeMembers", 0));
      setDevFakeChatSeconds(getUserValue("devFakeChatSeconds", 6));
      setDevFakeMuted(getUserValue("devFakeMuted", 0));
      setDevFakeScreenShare(getUserValue("devFakeScreenShare", false));
      setDevFakeDeafened(getUserValue("devFakeDeafened", false));
      setDevFakeSpeaking(getUserValue("devFakeSpeaking", true));
      setCameraFlipped(getUserValue("cameraFlipped", false));
      setCameraFpsState(getUserValue("cameraFps", 30));
      setCameraCodecState(getUserValue<VideoCodec>("cameraCodec", "auto"));
      setScreenShareQuality(getUserValue("screenShareQuality", "native"));
      setScreenShareFps(getUserValue("screenShareFps", 30));
      setExperimentalScreenShare(getUserValue("experimentalScreenShare", false));
      setScreenShareGamingModeState(getUserValue("screenShareGamingMode", true));
      setScreenShareCodecState(getUserValue<ScreenShareCodec>("screenShareCodec", "auto"));
      setScreenShareMaxBitrateState(getUserValue("screenShareMaxBitrate", 0));
      setScreenShareScalabilityModeState(getUserValue<ScalabilityMode>("screenShareScalabilityMode", "L1T3"));
      setUserVolumes(getUserValue("userVolumes", {}));
      setPinChannelsSidebarState(getUserValue("pinChannelsSidebar", true));
      setPinMembersSidebarState(getUserValue("pinMembersSidebar", true));
      setAfkTimeoutMinutes(getUserValue("afkTimeoutMinutes", 5));

      const seen = getUserValue<boolean>("hasSeenWelcome", false);
      setHasSeenWelcome(seen);
      // A returning user who never picked a nickname used to have Settings
      // opened on top of them here, with no explanation of why. They get the
      // tour instead, which at least says what it is pointing at.
      //
      // Once, though. This ran on every load, so a guest who skipped the tour
      // and never set a nickname was shown it again every time they opened
      // Gryt — the app nagging somebody for declining, forever.
      if (
        seen &&
        !getUserValue<string>("nickname", "") &&
        !getUserValue<boolean>("hasSeenTour", false)
      ) {
        setShowTour(true);
      }

      // Marked here rather than at the end of the effect. Everything the
      // first-run decisions rest on has been read by this point, and the avatar
      // below is a second await that has nothing to do with them — gating the
      // welcome on it would hold the dialog back for an image nobody is waiting
      // to see.
      setSettingsLoaded(true);

      const rec = await getStoredAvatar(userId).catch(() => null);
      if (cancelled || !rec?.blob) return;
      if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);
      const url = URL.createObjectURL(rec.blob);
      avatarObjectUrlRef.current = url;
      setAvatarDataUrlState(url);
    })();

    return () => {
      cancelled = true;
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
        avatarObjectUrlRef.current = null;
      }
      setAvatarDataUrlState(null);
    };
  }, [userId]);

  function updateAvatarDataUrl(dataUrl: string | null) {
    setAvatarDataUrlState(dataUrl);
  }

  async function setAvatarFile(file: File | null) {
    if (!file) {
      if (userId) await clearStoredAvatar(userId).catch(() => {});
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
        avatarObjectUrlRef.current = null;
      }
      setAvatarDataUrlState(null);
      return;
    }

    if (userId) await setStoredAvatar(userId, file, file.type || null).catch(() => {});
    if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    avatarObjectUrlRef.current = url;
    setAvatarDataUrlState(url);
  }

  function updateNickname(newName: string) {
    setNickname(newName);
    setUserValue("nickname", newName);
  }

  function updateAfkTimeoutMinutes(newTimeout: number) {
    setAfkTimeoutMinutes(newTimeout);
    setUserValue("afkTimeoutMinutes", newTimeout);
  }

  function updateShowAdvanced(show: boolean) {
    setShowAdvanced(show);
    setUserValue("showAdvanced", show);
  }

  function updateShowDebugOverlay(show: boolean) {
    setShowDebugOverlay(show);
    setUserValue("showDebugOverlay", show);
  }

  function updateShowVideoDebugOverlay(show: boolean) {
    setShowVideoDebugOverlay(show);
    setUserValue("showVideoDebugOverlay", show);
  }

  function updateShowPeerLatency(value: boolean) {
    setShowPeerLatency(value);
    setUserValue("showPeerLatency", value);
  }

  function updateChatMediaVolume(volume: number) {
    setChatMediaVolume(volume);
    setUserValue("chatMediaVolume", volume);
  }

  function updateBlurProfanity(enabled: boolean) {
    setBlurProfanityState(enabled);
    setUserValue("blurProfanity", enabled);
  }

  function updateSmileyConversion(enabled: boolean) {
    setSmileyConversionState(enabled);
    setUserValue("smileyConversion", enabled);
  }

  function updateDisabledSmileys(shortcodes: ReadonlySet<string>) {
    setDisabledSmileysState(shortcodes);
    setUserValue("disabledSmileys", [...shortcodes]);
  }

  function updateCameraID(id: string) {
    setCameraID(id);
    setUserValue("cameraID", id);
  }

  function updateCameraQuality(quality: string) {
    setCameraQuality(quality);
    setUserValue("cameraQuality", quality);
  }

  function updateCameraMirrored(mirrored: boolean) {
    setCameraMirrored(mirrored);
    setUserValue("cameraMirrored", mirrored);
  }

  function updateFaceFramingEnabled(enabled: boolean) {
    setFaceFramingEnabled(enabled);
    setUserValue("faceFramingEnabled", enabled);
  }

  function updateDevFakeParticipants(count: number) {
    setDevFakeParticipants(count);
    setUserValue("devFakeParticipants", count);
  }

  function updateDevFakeMembers(count: number) {
    setDevFakeMembers(count);
    setUserValue("devFakeMembers", count);
  }

  function updateDevFakeChatSeconds(seconds: number) {
    setDevFakeChatSeconds(seconds);
    setUserValue("devFakeChatSeconds", seconds);
  }

  function updateDevFakeMuted(count: number) {
    setDevFakeMuted(count);
    setUserValue("devFakeMuted", count);
  }

  function updateDevFakeScreenShare(enabled: boolean) {
    setDevFakeScreenShare(enabled);
    setUserValue("devFakeScreenShare", enabled);
  }

  function updateDevFakeDeafened(enabled: boolean) {
    setDevFakeDeafened(enabled);
    setUserValue("devFakeDeafened", enabled);
  }

  function updateDevFakeSpeaking(enabled: boolean) {
    setDevFakeSpeaking(enabled);
    setUserValue("devFakeSpeaking", enabled);
  }

  function updateVoiceTileLayout(layout: VoiceTileLayout) {
    setVoiceTileLayout(layout);
    setUserValue("voiceTileLayout", layout);
  }

  function updateCameraFlipped(flipped: boolean) {
    setCameraFlipped(flipped);
    setUserValue("cameraFlipped", flipped);
  }

  function updateCameraFps(fps: number) {
    setCameraFpsState(fps);
    setUserValue("cameraFps", fps);
  }

  function updateCameraCodec(codec: VideoCodec) {
    setCameraCodecState(codec);
    setUserValue("cameraCodec", codec);
  }

  function updateScreenShareQuality(quality: string) {
    setScreenShareQuality(quality);
    setUserValue("screenShareQuality", quality);
  }

  function updateScreenShareFps(fps: number) {
    setScreenShareFps(fps);
    setUserValue("screenShareFps", fps);
  }

  function updateExperimentalScreenShare(enabled: boolean) {
    setExperimentalScreenShare(enabled);
    setUserValue("experimentalScreenShare", enabled);
  }

  function updateScreenShareGamingMode(enabled: boolean) {
    setScreenShareGamingModeState(enabled);
    setUserValue("screenShareGamingMode", enabled);
  }

  function updateScreenShareCodec(codec: ScreenShareCodec) {
    setScreenShareCodecState(codec);
    setUserValue("screenShareCodec", codec);
  }

  function updateScreenShareMaxBitrate(bps: number) {
    setScreenShareMaxBitrateState(bps);
    setUserValue("screenShareMaxBitrate", bps);
  }

  function updateScreenShareScalabilityMode(mode: ScalabilityMode) {
    setScreenShareScalabilityModeState(mode);
    setUserValue("screenShareScalabilityMode", mode);
  }

  function updateUserVolume(serverUserId: string, volume: number) {
    setUserVolumes((prev) => {
      const next = { ...prev, [serverUserId]: volume };
      setUserValue("userVolumes", next);
      return next;
    });
  }

  function resetUserVolume(serverUserId: string) {
    setUserVolumes((prev) => {
      const next = { ...prev };
      delete next[serverUserId];
      setUserValue("userVolumes", next);
      return next;
    });
  }

  /**
   * Close the welcome, and say whether the tour follows.
   *
   * Takes its answer in an options object rather than a bare boolean, which is
   * defensive on purpose: this gets wired to `onOpenChange`, and a handler that
   * receives an event where it expected a flag reads it as truthy. An event
   * object here yields `startTour: undefined`, so the accident is a skip — the
   * quiet outcome rather than the app suddenly performing a tour nobody asked
   * for.
   *
   * The tour still only runs for somebody who has not picked a nickname; asking
   * for it does not force it on a returning user who already has one.
   */
  function completeWelcome(options?: { startTour?: boolean }) {
    setHasSeenWelcome(true);
    setUserValue("hasSeenWelcome", true);
    if (
      options?.startTour === true &&
      !getUserValue<string>("nickname", "") &&
      !getUserValue<boolean>("hasSeenTour", false)
    ) {
      setShowTour(true);
    }
  }

  /**
   * Called when the tour finishes and when it is skipped, because both are the
   * same statement: I am done with this. Written down, so it is still true
   * after a reload.
   */
  function dismissTour() {
    setShowTour(false);
    setUserValue("hasSeenTour", true);
  }

  function openSettings(tab: string = "appearance") {
    setSettingsTab(tab);
    setShowSettings(true);
  }

  function updatePinChannelsSidebar(pinned: boolean) {
    setPinChannelsSidebarState(pinned);
    setUserValue("pinChannelsSidebar", pinned);
  }

  function updatePinMembersSidebar(pinned: boolean) {
    setPinMembersSidebarState(pinned);
    setUserValue("pinMembersSidebar", pinned);
  }

  return {
    ...audio,
    nickname,
    setNickname: updateNickname,
    avatarDataUrl,
    setAvatarDataUrl: updateAvatarDataUrl,
    setAvatarFile,
    showSettings,
    setShowSettings,
    settingsTab,
    setSettingsTab,
    openSettings,
    showNickname,
    setShowNickname,
    hasSeenWelcome,
    settingsLoaded,
    completeWelcome,
    showTour,
    dismissTour,
    showVoiceView,
    setShowVoiceView,
    pinChannelsSidebar,
    setPinChannelsSidebar: updatePinChannelsSidebar,
    pinMembersSidebar,
    setPinMembersSidebar: updatePinMembersSidebar,
    isAFK,
    setIsAFK,
    afkTimeoutMinutes,
    setAfkTimeoutMinutes: updateAfkTimeoutMinutes,
    showAdvanced,
    setShowAdvanced: updateShowAdvanced,
    showDebugOverlay,
    setShowDebugOverlay: updateShowDebugOverlay,
    showVideoDebugOverlay,
    setShowVideoDebugOverlay: updateShowVideoDebugOverlay,
    showPeerLatency,
    setShowPeerLatency: updateShowPeerLatency,
    chatMediaVolume,
    setChatMediaVolume: updateChatMediaVolume,
    blurProfanity,
    setBlurProfanity: updateBlurProfanity,
    smileyConversion,
    setSmileyConversion: updateSmileyConversion,
    disabledSmileys,
    setDisabledSmileys: updateDisabledSmileys,
    cameraID,
    setCameraID: updateCameraID,
    cameraQuality,
    setCameraQuality: updateCameraQuality,
    cameraMirrored,
    setCameraMirrored: updateCameraMirrored,
    faceFramingEnabled,
    setFaceFramingEnabled: updateFaceFramingEnabled,
    voiceTileLayout,
    setVoiceTileLayout: updateVoiceTileLayout,
    devFakeParticipants,
    setDevFakeParticipants: updateDevFakeParticipants,
    devFakeMembers,
    setDevFakeMembers: updateDevFakeMembers,
    devFakeChatSeconds,
    setDevFakeChatSeconds: updateDevFakeChatSeconds,
    devFakeMuted,
    setDevFakeMuted: updateDevFakeMuted,
    devFakeScreenShare,
    setDevFakeScreenShare: updateDevFakeScreenShare,
    devFakeDeafened,
    setDevFakeDeafened: updateDevFakeDeafened,
    devFakeSpeaking,
    setDevFakeSpeaking: updateDevFakeSpeaking,
    cameraFlipped,
    setCameraFlipped: updateCameraFlipped,
    cameraFps,
    setCameraFps: updateCameraFps,
    cameraCodec,
    setCameraCodec: updateCameraCodec,
    screenShareQuality,
    setScreenShareQuality: updateScreenShareQuality,
    screenShareFps,
    setScreenShareFps: updateScreenShareFps,
    experimentalScreenShare,
    setExperimentalScreenShare: updateExperimentalScreenShare,
    screenShareGamingMode,
    setScreenShareGamingMode: updateScreenShareGamingMode,
    screenShareCodec,
    setScreenShareCodec: updateScreenShareCodec,
    screenShareMaxBitrate,
    setScreenShareMaxBitrate: updateScreenShareMaxBitrate,
    screenShareScalabilityMode,
    setScreenShareScalabilityMode: updateScreenShareScalabilityMode,
    userVolumes,
    updateUserVolume,
    resetUserVolume,
  };
}

export const useSettings = singletonHook(settingsInit, useSettingsHook);
