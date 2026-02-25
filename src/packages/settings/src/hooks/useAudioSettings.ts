import { useState } from "react";

import {
  readInitialMicID,
  readInitialMicVolume,
  readNumeric,
  updateRnnoiseEnabled,
  updateStorage,
} from "./settingsStorage";

export function useAudioSettings() {
  const [loopbackEnabled, setLoopbackEnabled] = useState(false);
  const [isMuted, setIsMutedState] = useState(false);
  const [isDeafened, setIsDeafenedState] = useState(false);
  const [preDeafenMuteState, setPreDeafenMuteState] = useState(false);
  const [isServerMuted, setIsServerMuted] = useState(false);
  const [isServerDeafened, setIsServerDeafened] = useState(false);

  const [rnnoiseEnabled, setRnnoiseEnabled] = useState(
    localStorage.getItem("rnnoiseEnabled") !== "false"
  );
  const [autoGainEnabled, setAutoGainEnabled] = useState(
    localStorage.getItem("autoGainEnabled") !== "false"
  );
  const [autoGainTargetDb, setAutoGainTargetDb] = useState(
    readNumeric("autoGainTargetDb", -20)
  );
  const [compressorEnabled, setCompressorEnabled] = useState(
    localStorage.getItem("compressorEnabled") !== "false"
  );
  const [compressorAmount, setCompressorAmount] = useState(
    readNumeric("compressorAmount", 50)
  );

  const [micID, setMicID] = useState<string | undefined>(readInitialMicID);
  const [outputDeviceID, setOutputDeviceID] = useState(
    localStorage.getItem("outputDeviceID") || ""
  );
  const [micVolume, setMicVolume] = useState(readInitialMicVolume);
  const [outputVolume, setOutputVolume] = useState(
    readNumeric("outputVolume", 50)
  );
  const [noiseGate, setNoiseGate] = useState(
    readNumeric("noiseGate", 1)
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
    readNumeric("connectSoundVolume", 30)
  );
  const [disconnectSoundVolume, setDisconnectSoundVolume] = useState(
    readNumeric("disconnectSoundVolume", 30)
  );
  const [customConnectSoundFile, setCustomConnectSoundFile] = useState<string | null>(
    localStorage.getItem("customConnectSoundFile") || null
  );
  const [customDisconnectSoundFile, setCustomDisconnectSoundFile] = useState<string | null>(
    localStorage.getItem("customDisconnectSoundFile") || null
  );

  const [messageSoundEnabled, setMessageSoundEnabled] = useState(
    localStorage.getItem("messageSoundEnabled") !== "false"
  );
  const [messageSoundVolume, setMessageSoundVolume] = useState(
    readNumeric("messageSoundVolume", 30)
  );
  const [customMessageSoundFile, setCustomMessageSoundFile] = useState<string | null>(
    localStorage.getItem("customMessageSoundFile") || null
  );

  const [notificationBadgeEnabled, setNotificationBadgeEnabled] = useState(
    localStorage.getItem("notificationBadgeEnabled") !== "false"
  );

  function updateMicID(newID: string) {
    if (!newID || newID.trim() === "") return;
    updateStorage("micID", newID, setMicID);
  }

  function updateOutputDeviceID(id: string) {
    setOutputDeviceID(id);
    if (id) {
      localStorage.setItem("outputDeviceID", id);
    } else {
      localStorage.removeItem("outputDeviceID");
    }
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

  function updateNotificationBadgeEnabled(value: boolean) {
    setNotificationBadgeEnabled(value);
    localStorage.setItem("notificationBadgeEnabled", value.toString());
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
