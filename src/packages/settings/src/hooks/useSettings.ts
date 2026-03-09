import { useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import {
  clearStoredAvatar,
  getStoredAvatar,
  setStoredAvatar,
  useUserId,
} from "@/common";

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

  const avatarObjectUrlRef = useRef<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrlState] = useState<string | null>(null);

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
      if (seen) {
        setHasSeenWelcome(true);
        if (!getUserValue<string>("nickname", "")) {
          setSettingsTab("profile");
          setShowSettings(true);
        }
      } else {
        setHasSeenWelcome(false);
      }

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

  function updateHasSeenWelcome() {
    setHasSeenWelcome(true);
    setUserValue("hasSeenWelcome", true);
    if (!getUserValue<string>("nickname", "")) {
      setSettingsTab("profile");
      setShowSettings(true);
    }
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
    updateHasSeenWelcome,
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
