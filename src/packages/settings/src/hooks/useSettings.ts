import { useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { clearStoredAvatar, getStoredAvatar, setStoredAvatar } from "@/common";

import {
  readInitialMicID,
  readInitialMicVolume,
  settingsInit,
  updateRnnoiseEnabled,
  updateStorage,
} from "./settingsStorage";


function useSettingsHook() {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("profile");
  const [showNickname, setShowNickname] = useState(false);
  const [hasSeenWelcome, setHasSeenWelcome] = useState(true);
  const [loopbackEnabled, setLoopbackEnabled] = useState(false);
  const [isMuted, setIsMutedState] = useState(false);
  const [isDeafened, setIsDeafenedState] = useState(false);
  const [preDeafenMuteState, setPreDeafenMuteState] = useState(false);

  const [rnnoiseEnabled, setRnnoiseEnabled] = useState(
    localStorage.getItem("rnnoiseEnabled") !== "false"
  );

  const [autoGainEnabled, setAutoGainEnabled] = useState(
    localStorage.getItem("autoGainEnabled") !== "false"
  );
  const [autoGainTargetDb, setAutoGainTargetDb] = useState(
    Number(localStorage.getItem("autoGainTargetDb")) || -20
  );
  const [compressorEnabled, setCompressorEnabled] = useState(
    localStorage.getItem("compressorEnabled") !== "false"
  );
  const [compressorAmount, setCompressorAmount] = useState(
    Number(localStorage.getItem("compressorAmount")) || 50
  );

  const avatarObjectUrlRef = useRef<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrlState] = useState<string | null>(null);

  const [showDebugOverlay, setShowDebugOverlay] = useState(
    localStorage.getItem("showDebugOverlay") === "true"
  );

  const [eSportsModeEnabled, setESportsModeEnabled] = useState(
    localStorage.getItem("eSportsModeEnabled") === "true"
  );
  const [inputMode, setInputMode] = useState<"voice_activity" | "push_to_talk">(
    (localStorage.getItem("inputMode") as "voice_activity" | "push_to_talk") || "voice_activity"
  );
  const [pushToTalkKey, setPushToTalkKey] = useState(
    localStorage.getItem("pushToTalkKey") || ""
  );
  const [muteHotkey, setMuteHotkey] = useState(
    localStorage.getItem("muteHotkey") || ""
  );
  const [deafenHotkey, setDeafenHotkey] = useState(
    localStorage.getItem("deafenHotkey") || ""
  );
  const [disconnectHotkey, setDisconnectHotkey] = useState(
    localStorage.getItem("disconnectHotkey") || ""
  );

  const [connectSoundEnabled, setConnectSoundEnabled] = useState(
    localStorage.getItem("connectSoundEnabled") !== "false"
  );
  const [disconnectSoundEnabled, setDisconnectSoundEnabled] = useState(
    localStorage.getItem("disconnectSoundEnabled") !== "false"
  );
  const [connectSoundVolume, setConnectSoundVolume] = useState(
    Number(localStorage.getItem("connectSoundVolume")) || 10
  );
  const [disconnectSoundVolume, setDisconnectSoundVolume] = useState(
    Number(localStorage.getItem("disconnectSoundVolume")) || 10
  );
  const [customConnectSoundFile, setCustomConnectSoundFile] = useState<string | null>(
    localStorage.getItem("customConnectSoundFile") || null
  );
  const [customDisconnectSoundFile, setCustomDisconnectSoundFile] = useState<string | null>(
    localStorage.getItem("customDisconnectSoundFile") || null
  );

  const [micID, setMicID] = useState<string | undefined>(readInitialMicID);
  const [nickname, setNickname] = useState(
    localStorage.getItem("nickname") || "Unknown"
  );
  const [micVolume, setMicVolume] = useState(readInitialMicVolume);
  const [outputVolume, setOutputVolume] = useState(
    Number(localStorage.getItem("outputVolume")) || 50
  );
  const [noiseGate, setNoiseGate] = useState(
    Number(localStorage.getItem("noiseGate")) || 10
  );

  const [showPeerLatency, setShowPeerLatency] = useState(
    localStorage.getItem("showPeerLatency") !== "false"
  );

  const [notificationBadgeEnabled, setNotificationBadgeEnabled] = useState(
    localStorage.getItem("notificationBadgeEnabled") !== "false"
  );

  const [messageSoundEnabled, setMessageSoundEnabled] = useState(
    localStorage.getItem("messageSoundEnabled") !== "false"
  );
  const [messageSoundVolume, setMessageSoundVolume] = useState(
    Number(localStorage.getItem("messageSoundVolume")) || 30
  );
  const [customMessageSoundFile, setCustomMessageSoundFile] = useState<string | null>(
    localStorage.getItem("customMessageSoundFile") || null
  );

  const [chatMediaVolume, setChatMediaVolume] = useState(
    Number(localStorage.getItem("chatMediaVolume")) || 50
  );

  const [blurProfanity, setBlurProfanityState] = useState(
    localStorage.getItem("blurProfanity") !== "false"
  );

  const [cameraID, setCameraID] = useState(
    localStorage.getItem("cameraID") || ""
  );
  const [cameraQuality, setCameraQuality] = useState(
    localStorage.getItem("cameraQuality") || "720p"
  );
  const [cameraMirrored, setCameraMirrored] = useState(
    localStorage.getItem("cameraMirrored") !== "false"
  );

  const [screenShareQuality, setScreenShareQuality] = useState(
    localStorage.getItem("screenShareQuality") || "native"
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
    Number(localStorage.getItem("afkTimeoutMinutes")) || 5
  );

  // Legacy setter (kept for compatibility). Prefer `setAvatarFile` to avoid localStorage quota issues.
  function updateAvatarDataUrl(dataUrl: string | null) {
    setAvatarDataUrlState(dataUrl);
  }

  async function setAvatarFile(file: File | null) {
    if (!file) {
      await clearStoredAvatar().catch(() => {});
      localStorage.removeItem("avatarDataUrl"); // migrate away from legacy storage
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

  function updateMicID(newID: string) {
    if (!newID || newID.trim() === "") return;
    updateStorage("micID", newID, setMicID);
  }

  function updateNickname(newName: string) {
    updateStorage("nickname", newName, setNickname);
  }

  function updateMicVolume(newVol: number) {
    setMicVolume(newVol);
    localStorage.setItem("micVolume", newVol.toString());
  }

  function updateOutputVolume(newVol: number) {
    setOutputVolume(newVol);
    localStorage.setItem("outputVolume", newVol.toString());
  }

  function updateNoiseGate(newGate: number) {
    setNoiseGate(newGate);
    localStorage.setItem("noiseGate", newGate.toString());
  }

  function updateAutoGainEnabled(enabled: boolean) {
    setAutoGainEnabled(enabled);
    localStorage.setItem("autoGainEnabled", enabled.toString());
  }

  function updateAutoGainTargetDb(value: number) {
    setAutoGainTargetDb(value);
    localStorage.setItem("autoGainTargetDb", value.toString());
  }

  function updateCompressorEnabled(enabled: boolean) {
    setCompressorEnabled(enabled);
    localStorage.setItem("compressorEnabled", enabled.toString());
  }

  function updateCompressorAmount(value: number) {
    setCompressorAmount(value);
    localStorage.setItem("compressorAmount", value.toString());
  }

  function updateAfkTimeoutMinutes(newTimeout: number) {
    setAfkTimeoutMinutes(newTimeout);
    localStorage.setItem("afkTimeoutMinutes", newTimeout.toString());
  }

  function updateShowDebugOverlay(show: boolean) {
    setShowDebugOverlay(show);
    localStorage.setItem("showDebugOverlay", show.toString());
  }

  function updateConnectSoundEnabled(enabled: boolean) {
    setConnectSoundEnabled(enabled);
    localStorage.setItem("connectSoundEnabled", enabled.toString());
  }

  function updateDisconnectSoundEnabled(enabled: boolean) {
    setDisconnectSoundEnabled(enabled);
    localStorage.setItem("disconnectSoundEnabled", enabled.toString());
  }

  function updateConnectSoundVolume(volume: number) {
    setConnectSoundVolume(volume);
    localStorage.setItem("connectSoundVolume", volume.toString());
  }

  function updateDisconnectSoundVolume(volume: number) {
    setDisconnectSoundVolume(volume);
    localStorage.setItem("disconnectSoundVolume", volume.toString());
  }

  function updateCustomConnectSoundFile(file: string | null) {
    if (file) {
      updateStorage("customConnectSoundFile", file, setCustomConnectSoundFile);
    } else {
      localStorage.removeItem("customConnectSoundFile");
      setCustomConnectSoundFile(null);
    }
  }

  function updateCustomDisconnectSoundFile(file: string | null) {
    if (file) {
      updateStorage("customDisconnectSoundFile", file, setCustomDisconnectSoundFile);
    } else {
      localStorage.removeItem("customDisconnectSoundFile");
      setCustomDisconnectSoundFile(null);
    }
  }

  function updateESportsModeEnabled(enabled: boolean) {
    setESportsModeEnabled(enabled);
    localStorage.setItem("eSportsModeEnabled", enabled.toString());
    if (enabled) {
      localStorage.setItem("preEsportsSettings", JSON.stringify({
        inputMode,
        rnnoiseEnabled,
        noiseGate,
      }));
      updateInputMode("push_to_talk");
      updateRnnoiseEnabled(false, setRnnoiseEnabled);
      updateNoiseGate(0);
    } else {
      const saved = localStorage.getItem("preEsportsSettings");
      if (saved) {
        try {
          const prev = JSON.parse(saved);
          if (prev.inputMode) updateInputMode(prev.inputMode);
          if (typeof prev.rnnoiseEnabled === "boolean") updateRnnoiseEnabled(prev.rnnoiseEnabled, setRnnoiseEnabled);
          if (typeof prev.noiseGate === "number") updateNoiseGate(prev.noiseGate);
        } catch { /* ignore corrupt data */ }
        localStorage.removeItem("preEsportsSettings");
      }
    }
  }

  function updateInputMode(mode: "voice_activity" | "push_to_talk") {
    setInputMode(mode);
    localStorage.setItem("inputMode", mode);
  }

  function updatePushToTalkKey(key: string) {
    setPushToTalkKey(key);
    localStorage.setItem("pushToTalkKey", key);
  }

  function updateMuteHotkey(key: string) {
    setMuteHotkey(key);
    localStorage.setItem("muteHotkey", key);
  }

  function updateDeafenHotkey(key: string) {
    setDeafenHotkey(key);
    localStorage.setItem("deafenHotkey", key);
  }

  function updateDisconnectHotkey(key: string) {
    setDisconnectHotkey(key);
    localStorage.setItem("disconnectHotkey", key);
  }

  function updateShowPeerLatency(value: boolean) {
    setShowPeerLatency(value);
    localStorage.setItem("showPeerLatency", value.toString());
  }

  function updateNotificationBadgeEnabled(value: boolean) {
    setNotificationBadgeEnabled(value);
    localStorage.setItem("notificationBadgeEnabled", value.toString());
    if (!value) window.electronAPI?.setBadgeCount(0);
  }

  function updateMessageSoundEnabled(enabled: boolean) {
    setMessageSoundEnabled(enabled);
    localStorage.setItem("messageSoundEnabled", enabled.toString());
  }

  function updateMessageSoundVolume(volume: number) {
    setMessageSoundVolume(volume);
    localStorage.setItem("messageSoundVolume", volume.toString());
  }

  function updateCustomMessageSoundFile(file: string | null) {
    if (file) {
      updateStorage("customMessageSoundFile", file, setCustomMessageSoundFile);
    } else {
      localStorage.removeItem("customMessageSoundFile");
      setCustomMessageSoundFile(null);
    }
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

  function setIsMuted(muted: boolean) {
    if (muted) {
      setIsMutedState(true);
    } else {
      setIsMutedState(false);
      if (isDeafened) {
        setIsDeafenedState(false);
      }
    }
  }

  function setIsDeafened(deafened: boolean) {
    if (deafened) {
      setPreDeafenMuteState(isMuted);
      setIsDeafenedState(true);
      setIsMutedState(true);
    } else {
      setIsDeafenedState(false);
      setIsMutedState(preDeafenMuteState);
    }
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
      // One-time migration: if a legacy data URL exists in localStorage, move it to IndexedDB.
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
    micID,
    setMicID: updateMicID,
    nickname,
    setNickname: updateNickname,
    avatarDataUrl,
    setAvatarDataUrl: updateAvatarDataUrl,
    setAvatarFile,
    micVolume,
    setMicVolume: updateMicVolume,
    outputVolume,
    setOutputVolume: updateOutputVolume,
    noiseGate,
    setNoiseGate: updateNoiseGate,
    loopbackEnabled,
    setLoopbackEnabled,
    rnnoiseEnabled,
    setRnnoiseEnabled: (value: boolean) => updateRnnoiseEnabled(value, setRnnoiseEnabled),
    autoGainEnabled,
    setAutoGainEnabled: updateAutoGainEnabled,
    autoGainTargetDb,
    setAutoGainTargetDb: updateAutoGainTargetDb,
    compressorEnabled,
    setCompressorEnabled: updateCompressorEnabled,
    compressorAmount,
    setCompressorAmount: updateCompressorAmount,
    isMuted,
    setIsMuted,
    isDeafened,
    setIsDeafened,
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

    connectSoundEnabled,
    setConnectSoundEnabled: updateConnectSoundEnabled,
    disconnectSoundEnabled,
    setDisconnectSoundEnabled: updateDisconnectSoundEnabled,
    connectSoundVolume,
    setConnectSoundVolume: updateConnectSoundVolume,
    disconnectSoundVolume,
    setDisconnectSoundVolume: updateDisconnectSoundVolume,
    customConnectSoundFile,
    setCustomConnectSoundFile: updateCustomConnectSoundFile,
    customDisconnectSoundFile,
    setCustomDisconnectSoundFile: updateCustomDisconnectSoundFile,
    isAFK,
    setIsAFK,
    afkTimeoutMinutes,
    setAfkTimeoutMinutes: updateAfkTimeoutMinutes,
    showDebugOverlay,
    setShowDebugOverlay: updateShowDebugOverlay,
    eSportsModeEnabled,
    setESportsModeEnabled: updateESportsModeEnabled,
    inputMode,
    setInputMode: updateInputMode,
    pushToTalkKey,
    setPushToTalkKey: updatePushToTalkKey,
    muteHotkey,
    setMuteHotkey: updateMuteHotkey,
    deafenHotkey,
    setDeafenHotkey: updateDeafenHotkey,
    disconnectHotkey,
    setDisconnectHotkey: updateDisconnectHotkey,
    showPeerLatency,
    setShowPeerLatency: updateShowPeerLatency,
    notificationBadgeEnabled,
    setNotificationBadgeEnabled: updateNotificationBadgeEnabled,
    messageSoundEnabled,
    setMessageSoundEnabled: updateMessageSoundEnabled,
    messageSoundVolume,
    setMessageSoundVolume: updateMessageSoundVolume,
    customMessageSoundFile,
    setCustomMessageSoundFile: updateCustomMessageSoundFile,
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
    userVolumes,
    updateUserVolume,
    resetUserVolume,
  };
}

export const useSettings = singletonHook(settingsInit, useSettingsHook);
