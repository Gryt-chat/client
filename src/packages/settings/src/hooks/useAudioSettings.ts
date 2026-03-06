import { useState } from "react";

import { getUserValue, setUserValue } from "./userStorage";

export interface AudioSettingsData {
  micID?: string;
  outputDeviceID: string;
  micVolume: number;
  outputVolume: number;
  noiseGate: number;
  noiseGateRelease: number;
  rnnoiseEnabled: boolean;
  autoGainEnabled: boolean;
  autoGainTargetDb: number;
  compressorEnabled: boolean;
  compressorAmount: number;
  eSportsModeEnabled: boolean;
  inputMode: "voice_activity" | "push_to_talk";
  pushToTalkKey: string;
  muteHotkey: string;
  deafenHotkey: string;
  disconnectHotkey: string;
  connectSoundEnabled: boolean;
  disconnectSoundEnabled: boolean;
  connectSoundVolume: number;
  disconnectSoundVolume: number;
  customConnectSoundFile: string | null;
  customDisconnectSoundFile: string | null;
  messageSoundEnabled: boolean;
  messageSoundVolume: number;
  customMessageSoundFile: string | null;
  notificationBadgeEnabled: boolean;
}

export const AUDIO_DEFAULTS: AudioSettingsData = {
  micID: undefined,
  outputDeviceID: "",
  micVolume: 50,
  outputVolume: 50,
  noiseGate: 1,
  noiseGateRelease: 200,
  rnnoiseEnabled: true,
  autoGainEnabled: true,
  autoGainTargetDb: -20,
  compressorEnabled: true,
  compressorAmount: 50,
  eSportsModeEnabled: false,
  inputMode: "voice_activity",
  pushToTalkKey: "",
  muteHotkey: "",
  deafenHotkey: "",
  disconnectHotkey: "",
  connectSoundEnabled: true,
  disconnectSoundEnabled: true,
  connectSoundVolume: 30,
  disconnectSoundVolume: 30,
  customConnectSoundFile: null,
  customDisconnectSoundFile: null,
  messageSoundEnabled: true,
  messageSoundVolume: 30,
  customMessageSoundFile: null,
  notificationBadgeEnabled: true,
};

export function loadAudioFromCache(): AudioSettingsData {
  const micId = getUserValue<string | undefined>("micID", undefined);
  return {
    micID: micId && micId !== "undefined" && micId.trim() !== "" ? micId : undefined,
    outputDeviceID: getUserValue("outputDeviceID", AUDIO_DEFAULTS.outputDeviceID),
    micVolume: getUserValue("micVolume", AUDIO_DEFAULTS.micVolume),
    outputVolume: getUserValue("outputVolume", AUDIO_DEFAULTS.outputVolume),
    noiseGate: getUserValue("noiseGate", AUDIO_DEFAULTS.noiseGate),
    noiseGateRelease: getUserValue("noiseGateRelease", AUDIO_DEFAULTS.noiseGateRelease),
    rnnoiseEnabled: getUserValue("rnnoiseEnabled", AUDIO_DEFAULTS.rnnoiseEnabled),
    autoGainEnabled: getUserValue("autoGainEnabled", AUDIO_DEFAULTS.autoGainEnabled),
    autoGainTargetDb: getUserValue("autoGainTargetDb", AUDIO_DEFAULTS.autoGainTargetDb),
    compressorEnabled: getUserValue("compressorEnabled", AUDIO_DEFAULTS.compressorEnabled),
    compressorAmount: getUserValue("compressorAmount", AUDIO_DEFAULTS.compressorAmount),
    eSportsModeEnabled: getUserValue("eSportsModeEnabled", AUDIO_DEFAULTS.eSportsModeEnabled),
    inputMode: getUserValue("inputMode", AUDIO_DEFAULTS.inputMode),
    pushToTalkKey: getUserValue("pushToTalkKey", AUDIO_DEFAULTS.pushToTalkKey),
    muteHotkey: getUserValue("muteHotkey", AUDIO_DEFAULTS.muteHotkey),
    deafenHotkey: getUserValue("deafenHotkey", AUDIO_DEFAULTS.deafenHotkey),
    disconnectHotkey: getUserValue("disconnectHotkey", AUDIO_DEFAULTS.disconnectHotkey),
    connectSoundEnabled: getUserValue("connectSoundEnabled", AUDIO_DEFAULTS.connectSoundEnabled),
    disconnectSoundEnabled: getUserValue("disconnectSoundEnabled", AUDIO_DEFAULTS.disconnectSoundEnabled),
    connectSoundVolume: getUserValue("connectSoundVolume", AUDIO_DEFAULTS.connectSoundVolume),
    disconnectSoundVolume: getUserValue("disconnectSoundVolume", AUDIO_DEFAULTS.disconnectSoundVolume),
    customConnectSoundFile: getUserValue("customConnectSoundFile", AUDIO_DEFAULTS.customConnectSoundFile),
    customDisconnectSoundFile: getUserValue("customDisconnectSoundFile", AUDIO_DEFAULTS.customDisconnectSoundFile),
    messageSoundEnabled: getUserValue("messageSoundEnabled", AUDIO_DEFAULTS.messageSoundEnabled),
    messageSoundVolume: getUserValue("messageSoundVolume", AUDIO_DEFAULTS.messageSoundVolume),
    customMessageSoundFile: getUserValue("customMessageSoundFile", AUDIO_DEFAULTS.customMessageSoundFile),
    notificationBadgeEnabled: getUserValue("notificationBadgeEnabled", AUDIO_DEFAULTS.notificationBadgeEnabled),
  };
}

export function useAudioSettings() {
  const [loopbackEnabled, setLoopbackEnabled] = useState(false);
  const [isMuted, setIsMutedState] = useState(false);
  const [isDeafened, setIsDeafenedState] = useState(false);
  const [preDeafenMuteState, setPreDeafenMuteState] = useState(false);
  const [isServerMuted, setIsServerMuted] = useState(false);
  const [isServerDeafened, setIsServerDeafened] = useState(false);

  const [rnnoiseEnabled, setRnnoiseEnabled] = useState(AUDIO_DEFAULTS.rnnoiseEnabled);
  const [autoGainEnabled, setAutoGainEnabled] = useState(AUDIO_DEFAULTS.autoGainEnabled);
  const [autoGainTargetDb, setAutoGainTargetDb] = useState(AUDIO_DEFAULTS.autoGainTargetDb);
  const [compressorEnabled, setCompressorEnabled] = useState(AUDIO_DEFAULTS.compressorEnabled);
  const [compressorAmount, setCompressorAmount] = useState(AUDIO_DEFAULTS.compressorAmount);

  const [micID, setMicID] = useState<string | undefined>(AUDIO_DEFAULTS.micID);
  const [outputDeviceID, setOutputDeviceID] = useState(AUDIO_DEFAULTS.outputDeviceID);
  const [micVolume, setMicVolume] = useState(AUDIO_DEFAULTS.micVolume);
  const [outputVolume, setOutputVolume] = useState(AUDIO_DEFAULTS.outputVolume);
  const [noiseGate, setNoiseGate] = useState(AUDIO_DEFAULTS.noiseGate);
  const [noiseGateRelease, setNoiseGateRelease] = useState(AUDIO_DEFAULTS.noiseGateRelease);

  const [eSportsModeEnabled, setESportsModeEnabled] = useState(AUDIO_DEFAULTS.eSportsModeEnabled);
  const [inputMode, setInputMode] = useState<"voice_activity" | "push_to_talk">(AUDIO_DEFAULTS.inputMode);
  const [pushToTalkKey, setPushToTalkKey] = useState(AUDIO_DEFAULTS.pushToTalkKey);
  const [muteHotkey, setMuteHotkey] = useState(AUDIO_DEFAULTS.muteHotkey);
  const [deafenHotkey, setDeafenHotkey] = useState(AUDIO_DEFAULTS.deafenHotkey);
  const [disconnectHotkey, setDisconnectHotkey] = useState(AUDIO_DEFAULTS.disconnectHotkey);

  const [connectSoundEnabled, setConnectSoundEnabled] = useState(AUDIO_DEFAULTS.connectSoundEnabled);
  const [disconnectSoundEnabled, setDisconnectSoundEnabled] = useState(AUDIO_DEFAULTS.disconnectSoundEnabled);
  const [connectSoundVolume, setConnectSoundVolume] = useState(AUDIO_DEFAULTS.connectSoundVolume);
  const [disconnectSoundVolume, setDisconnectSoundVolume] = useState(AUDIO_DEFAULTS.disconnectSoundVolume);
  const [customConnectSoundFile, setCustomConnectSoundFile] = useState<string | null>(AUDIO_DEFAULTS.customConnectSoundFile);
  const [customDisconnectSoundFile, setCustomDisconnectSoundFile] = useState<string | null>(AUDIO_DEFAULTS.customDisconnectSoundFile);

  const [messageSoundEnabled, setMessageSoundEnabled] = useState(AUDIO_DEFAULTS.messageSoundEnabled);
  const [messageSoundVolume, setMessageSoundVolume] = useState(AUDIO_DEFAULTS.messageSoundVolume);
  const [customMessageSoundFile, setCustomMessageSoundFile] = useState<string | null>(AUDIO_DEFAULTS.customMessageSoundFile);

  const [notificationBadgeEnabled, setNotificationBadgeEnabled] = useState(AUDIO_DEFAULTS.notificationBadgeEnabled);

  function applyAudioData(d: AudioSettingsData) {
    setMicID(d.micID);
    setOutputDeviceID(d.outputDeviceID);
    setMicVolume(d.micVolume);
    setOutputVolume(d.outputVolume);
    setNoiseGate(d.noiseGate);
    setNoiseGateRelease(d.noiseGateRelease);
    setRnnoiseEnabled(d.rnnoiseEnabled);
    setAutoGainEnabled(d.autoGainEnabled);
    setAutoGainTargetDb(d.autoGainTargetDb);
    setCompressorEnabled(d.compressorEnabled);
    setCompressorAmount(d.compressorAmount);
    setESportsModeEnabled(d.eSportsModeEnabled);
    setInputMode(d.inputMode);
    setPushToTalkKey(d.pushToTalkKey);
    setMuteHotkey(d.muteHotkey);
    setDeafenHotkey(d.deafenHotkey);
    setDisconnectHotkey(d.disconnectHotkey);
    setConnectSoundEnabled(d.connectSoundEnabled);
    setDisconnectSoundEnabled(d.disconnectSoundEnabled);
    setConnectSoundVolume(d.connectSoundVolume);
    setDisconnectSoundVolume(d.disconnectSoundVolume);
    setCustomConnectSoundFile(d.customConnectSoundFile);
    setCustomDisconnectSoundFile(d.customDisconnectSoundFile);
    setMessageSoundEnabled(d.messageSoundEnabled);
    setMessageSoundVolume(d.messageSoundVolume);
    setCustomMessageSoundFile(d.customMessageSoundFile);
    setNotificationBadgeEnabled(d.notificationBadgeEnabled);
  }

  function updateMicID(newID: string) {
    if (!newID || newID.trim() === "") return;
    setMicID(newID);
    setUserValue("micID", newID);
  }

  function updateOutputDeviceID(id: string) {
    setOutputDeviceID(id);
    if (id) {
      setUserValue("outputDeviceID", id);
    } else {
      setUserValue("outputDeviceID", "");
    }
  }

  function updateMicVolume(newVol: number) {
    setMicVolume(newVol);
    setUserValue("micVolume", newVol);
  }

  function updateOutputVolume(newVol: number) {
    setOutputVolume(newVol);
    setUserValue("outputVolume", newVol);
  }

  function updateNoiseGate(newGate: number) {
    setNoiseGate(newGate);
    setUserValue("noiseGate", newGate);
  }

  function updateNoiseGateRelease(ms: number) {
    setNoiseGateRelease(ms);
    setUserValue("noiseGateRelease", ms);
  }

  function updateRnnoiseEnabled(value: boolean) {
    setRnnoiseEnabled(value);
    setUserValue("rnnoiseEnabled", value);
  }

  function updateAutoGainEnabled(enabled: boolean) {
    setAutoGainEnabled(enabled);
    setUserValue("autoGainEnabled", enabled);
  }

  function updateAutoGainTargetDb(value: number) {
    setAutoGainTargetDb(value);
    setUserValue("autoGainTargetDb", value);
  }

  function updateCompressorEnabled(enabled: boolean) {
    setCompressorEnabled(enabled);
    setUserValue("compressorEnabled", enabled);
  }

  function updateCompressorAmount(value: number) {
    setCompressorAmount(value);
    setUserValue("compressorAmount", value);
  }

  function updateInputMode(mode: "voice_activity" | "push_to_talk") {
    setInputMode(mode);
    setUserValue("inputMode", mode);
  }

  function updatePushToTalkKey(key: string) {
    setPushToTalkKey(key);
    setUserValue("pushToTalkKey", key);
  }

  function updateMuteHotkey(key: string) {
    setMuteHotkey(key);
    setUserValue("muteHotkey", key);
  }

  function updateDeafenHotkey(key: string) {
    setDeafenHotkey(key);
    setUserValue("deafenHotkey", key);
  }

  function updateDisconnectHotkey(key: string) {
    setDisconnectHotkey(key);
    setUserValue("disconnectHotkey", key);
  }

  function updateESportsModeEnabled(enabled: boolean) {
    setESportsModeEnabled(enabled);
    setUserValue("eSportsModeEnabled", enabled);
    if (enabled) {
      setUserValue("preEsportsSettings", JSON.stringify({
        inputMode,
        rnnoiseEnabled,
        noiseGate,
      }));
      updateInputMode("push_to_talk");
      updateRnnoiseEnabled(false);
      updateNoiseGate(0);
    } else {
      const saved = getUserValue<string | null>("preEsportsSettings", null);
      if (saved) {
        try {
          const prev = JSON.parse(saved) as Record<string, unknown>;
          if (prev.inputMode) updateInputMode(prev.inputMode as "voice_activity" | "push_to_talk");
          if (typeof prev.rnnoiseEnabled === "boolean") updateRnnoiseEnabled(prev.rnnoiseEnabled);
          if (typeof prev.noiseGate === "number") updateNoiseGate(prev.noiseGate);
        } catch { /* ignore corrupt data */ }
        setUserValue("preEsportsSettings", null);
      }
    }
  }

  function updateConnectSoundEnabled(enabled: boolean) {
    setConnectSoundEnabled(enabled);
    setUserValue("connectSoundEnabled", enabled);
  }

  function updateDisconnectSoundEnabled(enabled: boolean) {
    setDisconnectSoundEnabled(enabled);
    setUserValue("disconnectSoundEnabled", enabled);
  }

  function updateConnectSoundVolume(volume: number) {
    setConnectSoundVolume(volume);
    setUserValue("connectSoundVolume", volume);
  }

  function updateDisconnectSoundVolume(volume: number) {
    setDisconnectSoundVolume(volume);
    setUserValue("disconnectSoundVolume", volume);
  }

  function updateCustomConnectSoundFile(file: string | null) {
    setCustomConnectSoundFile(file);
    if (file) {
      setUserValue("customConnectSoundFile", file);
    } else {
      setUserValue("customConnectSoundFile", null);
    }
  }

  function updateCustomDisconnectSoundFile(file: string | null) {
    setCustomDisconnectSoundFile(file);
    if (file) {
      setUserValue("customDisconnectSoundFile", file);
    } else {
      setUserValue("customDisconnectSoundFile", null);
    }
  }

  function updateMessageSoundEnabled(enabled: boolean) {
    setMessageSoundEnabled(enabled);
    setUserValue("messageSoundEnabled", enabled);
  }

  function updateMessageSoundVolume(volume: number) {
    setMessageSoundVolume(volume);
    setUserValue("messageSoundVolume", volume);
  }

  function updateCustomMessageSoundFile(file: string | null) {
    setCustomMessageSoundFile(file);
    if (file) {
      setUserValue("customMessageSoundFile", file);
    } else {
      setUserValue("customMessageSoundFile", null);
    }
  }

  function updateNotificationBadgeEnabled(value: boolean) {
    setNotificationBadgeEnabled(value);
    setUserValue("notificationBadgeEnabled", value);
    if (!value) window.electronAPI?.setBadgeCount(0);
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

  return {
    applyAudioData,
    micID,
    setMicID: updateMicID,
    outputDeviceID,
    setOutputDeviceID: updateOutputDeviceID,
    micVolume,
    setMicVolume: updateMicVolume,
    outputVolume,
    setOutputVolume: updateOutputVolume,
    noiseGate,
    setNoiseGate: updateNoiseGate,
    noiseGateRelease,
    setNoiseGateRelease: updateNoiseGateRelease,
    loopbackEnabled,
    setLoopbackEnabled,
    rnnoiseEnabled,
    setRnnoiseEnabled: updateRnnoiseEnabled,
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
    isServerMuted,
    setIsServerMuted,
    isServerDeafened,
    setIsServerDeafened,
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
    messageSoundEnabled,
    setMessageSoundEnabled: updateMessageSoundEnabled,
    messageSoundVolume,
    setMessageSoundVolume: updateMessageSoundVolume,
    customMessageSoundFile,
    setCustomMessageSoundFile: updateCustomMessageSoundFile,
    notificationBadgeEnabled,
    setNotificationBadgeEnabled: updateNotificationBadgeEnabled,
  };
}
