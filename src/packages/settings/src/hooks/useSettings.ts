import { useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { clearStoredAvatar, getStoredAvatar, setStoredAvatar } from "@/common";

import { readNumeric, settingsInit, updateStorage } from "./settingsStorage";
import { useAudioSettings } from "./useAudioSettings";


function useSettingsHook() {
  const audio = useAudioSettings();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("profile");
  const [showNickname, setShowNickname] = useState(false);
  const [hasSeenWelcome, setHasSeenWelcome] = useState(true);

  const avatarObjectUrlRef = useRef<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrlState] = useState<string | null>(null);

  const [showDebugOverlay, setShowDebugOverlay] = useState(
    localStorage.getItem("showDebugOverlay") === "true"
  );

  const [nickname, setNickname] = useState(
    localStorage.getItem("nickname") || "Unknown"
  );

  const [showPeerLatency, setShowPeerLatency] = useState(
    localStorage.getItem("showPeerLatency") !== "false"
  );

  const [chatMediaVolume, setChatMediaVolume] = useState(
    readNumeric("chatMediaVolume", 50)
  );

  const [blurProfanity, setBlurProfanityState] = useState(
    localStorage.getItem("blurProfanity") !== "false"
  );

  const [cameraID, setCameraID] = useState(
    localStorage.getItem("cameraID") || ""
  );
  const [cameraQuality, setCameraQuality] = useState(
    localStorage.getItem("cameraQuality") || "native"
  );
  const [cameraMirrored, setCameraMirrored] = useState(
    localStorage.getItem("cameraMirrored") !== "false"
  );

  const [screenShareQuality, setScreenShareQuality] = useState(
    localStorage.getItem("screenShareQuality") || "native"
  );
  const [screenShareFps, setScreenShareFps] = useState(
    readNumeric("screenShareFps", 30)
  );
  const [screenShareAudioDelay, setScreenShareAudioDelay] = useState(
    readNumeric("screenShareAudioDelay", 0)
  );
  const [experimentalScreenShare, setExperimentalScreenShare] = useState(
    localStorage.getItem("experimentalScreenShare") === "true"
  );

  const [userVolumes, setUserVolumes] = useState<Record<string, number>>(
    () => JSON.parse(localStorage.getItem("userVolumes") || "{}")
  );

  const [showVoiceView, setShowVoiceView] = useState(true);

  const [pinChannelsSidebar, setPinChannelsSidebarState] = useState(
    localStorage.getItem("pinChannelsSidebar") !== "false"
  );
  const [pinMembersSidebar, setPinMembersSidebarState] = useState(
    localStorage.getItem("pinMembersSidebar") !== "false"
  );

  const [isAFK, setIsAFK] = useState(false);
  const [afkTimeoutMinutes, setAfkTimeoutMinutes] = useState(
    readNumeric("afkTimeoutMinutes", 5)
  );

  function updateAvatarDataUrl(dataUrl: string | null) {
    setAvatarDataUrlState(dataUrl);
  }

  async function setAvatarFile(file: File | null) {
    if (!file) {
      await clearStoredAvatar().catch(() => {});
      localStorage.removeItem("avatarDataUrl");
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
        avatarObjectUrlRef.current = null;
      }
      setAvatarDataUrlState(null);
      return;
    }

    await setStoredAvatar(file, file.type || null).catch(() => {});
    if (avatarObjectUrlRef.current) URL.revokeObjectURL(avatarObjectUrlRef.current);
    const url = URL.createObjectURL(file);
    avatarObjectUrlRef.current = url;
    setAvatarDataUrlState(url);
  }

  function updateNickname(newName: string) {
    updateStorage("nickname", newName, setNickname);
  }

  function updateAfkTimeoutMinutes(newTimeout: number) {
    setAfkTimeoutMinutes(newTimeout);
    localStorage.setItem("afkTimeoutMinutes", newTimeout.toString());
  }

  function updateShowDebugOverlay(show: boolean) {
    setShowDebugOverlay(show);
    localStorage.setItem("showDebugOverlay", show.toString());
  }

  function updateShowPeerLatency(value: boolean) {
    setShowPeerLatency(value);
    localStorage.setItem("showPeerLatency", value.toString());
  }

  function updateChatMediaVolume(volume: number) {
    setChatMediaVolume(volume);
    localStorage.setItem("chatMediaVolume", volume.toString());
  }

  function updateBlurProfanity(enabled: boolean) {
    setBlurProfanityState(enabled);
    localStorage.setItem("blurProfanity", enabled.toString());
  }

  function updateCameraID(id: string) {
    setCameraID(id);
    localStorage.setItem("cameraID", id);
  }

  function updateCameraQuality(quality: string) {
    setCameraQuality(quality);
    localStorage.setItem("cameraQuality", quality);
  }

  function updateCameraMirrored(mirrored: boolean) {
    setCameraMirrored(mirrored);
    localStorage.setItem("cameraMirrored", mirrored.toString());
  }

  function updateScreenShareQuality(quality: string) {
    setScreenShareQuality(quality);
    localStorage.setItem("screenShareQuality", quality);
  }

  function updateScreenShareFps(fps: number) {
    setScreenShareFps(fps);
    localStorage.setItem("screenShareFps", fps.toString());
  }

  function updateScreenShareAudioDelay(ms: number) {
    setScreenShareAudioDelay(ms);
    localStorage.setItem("screenShareAudioDelay", ms.toString());
  }

  function updateExperimentalScreenShare(enabled: boolean) {
    setExperimentalScreenShare(enabled);
    localStorage.setItem("experimentalScreenShare", enabled.toString());
  }

  function updateUserVolume(serverUserId: string, volume: number) {
    setUserVolumes((prev) => {
      const next = { ...prev, [serverUserId]: volume };
      localStorage.setItem("userVolumes", JSON.stringify(next));
      return next;
    });
  }

  function resetUserVolume(serverUserId: string) {
    setUserVolumes((prev) => {
      const next = { ...prev };
      delete next[serverUserId];
      localStorage.setItem("userVolumes", JSON.stringify(next));
      return next;
    });
  }

  function updateHasSeenWelcome() {
    updateStorage("hasSeenWelcome", "true", () => setHasSeenWelcome(true));
    if (!localStorage.getItem("nickname")) {
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
    localStorage.setItem("pinChannelsSidebar", pinned.toString());
  }

  function updatePinMembersSidebar(pinned: boolean) {
    setPinMembersSidebarState(pinned);
    localStorage.setItem("pinMembersSidebar", pinned.toString());
  }

  useEffect(() => {
    if (localStorage.getItem("hasSeenWelcome")) {
      setHasSeenWelcome(true);
      if (!localStorage.getItem("nickname")) {
        setSettingsTab("profile");
        setShowSettings(true);
      }
    } else {
      setHasSeenWelcome(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const legacy = localStorage.getItem("avatarDataUrl");
      if (legacy && legacy.startsWith("data:")) {
        try {
          const b = await (await fetch(legacy)).blob();
          await setStoredAvatar(b, b.type || null);
          localStorage.removeItem("avatarDataUrl");
        } catch {
          // ignore
        }
      }

      const rec = await getStoredAvatar().catch(() => null);
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
    };
  }, []);

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
    showPeerLatency,
    setShowPeerLatency: updateShowPeerLatency,
    chatMediaVolume,
    setChatMediaVolume: updateChatMediaVolume,
    blurProfanity,
    setBlurProfanity: updateBlurProfanity,
    cameraID,
    setCameraID: updateCameraID,
    cameraQuality,
    setCameraQuality: updateCameraQuality,
    cameraMirrored,
    setCameraMirrored: updateCameraMirrored,
    screenShareQuality,
    setScreenShareQuality: updateScreenShareQuality,
    screenShareFps,
    setScreenShareFps: updateScreenShareFps,
    screenShareAudioDelay,
    setScreenShareAudioDelay: updateScreenShareAudioDelay,
    experimentalScreenShare,
    setExperimentalScreenShare: updateExperimentalScreenShare,
    userVolumes,
    updateUserVolume,
    resetUserVolume,
  };
}

export const useSettings = singletonHook(settingsInit, useSettingsHook);
