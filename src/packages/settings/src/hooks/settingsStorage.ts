export interface Settings {
  micID?: string;
  setMicID: (id: string) => void;
  micVolume: number;
  setMicVolume: (num: number) => void;
  outputVolume: number;
  setOutputVolume: (num: number) => void;
  noiseGate: number;
  setNoiseGate: (num: number) => void;
  setLoopbackEnabled: (value: boolean) => void;
  loopbackEnabled: boolean;

  rnnoiseEnabled: boolean;
  setRnnoiseEnabled: (value: boolean) => void;

  autoGainEnabled: boolean;
  setAutoGainEnabled: (value: boolean) => void;
  autoGainTargetDb: number;
  setAutoGainTargetDb: (value: number) => void;

  compressorEnabled: boolean;
  setCompressorEnabled: (value: boolean) => void;
  compressorAmount: number;
  setCompressorAmount: (value: number) => void;

  connectSoundEnabled: boolean;
  setConnectSoundEnabled: (value: boolean) => void;
  disconnectSoundEnabled: boolean;
  setDisconnectSoundEnabled: (value: boolean) => void;
  connectSoundVolume: number;
  setConnectSoundVolume: (value: number) => void;
  disconnectSoundVolume: number;
  setDisconnectSoundVolume: (value: number) => void;
  customConnectSoundFile: string | null;
  setCustomConnectSoundFile: (value: string | null) => void;
  customDisconnectSoundFile: string | null;
  setCustomDisconnectSoundFile: (value: string | null) => void;

  setNickname: (name: string) => void;
  nickname: string;

  avatarDataUrl: string | null;
  setAvatarDataUrl: (value: string | null) => void;
  setAvatarFile: (file: File | null) => Promise<void>;

  isMuted: boolean;
  setIsMuted: (value: boolean) => void;
  isDeafened: boolean;
  setIsDeafened: (value: boolean) => void;

  isAFK: boolean;
  setIsAFK: (value: boolean) => void;
  afkTimeoutMinutes: number;
  setAfkTimeoutMinutes: (value: number) => void;

  showSettings: boolean;
  setShowSettings: (value: boolean) => void;

  showNickname: boolean;
  setShowNickname: (value: boolean) => void;

  hasSeenWelcome: boolean;
  updateHasSeenWelcome: () => void;

  showVoiceView: boolean;
  setShowVoiceView: (value: boolean) => void;

  pinChannelsSidebar: boolean;
  setPinChannelsSidebar: (value: boolean) => void;
  pinMembersSidebar: boolean;
  setPinMembersSidebar: (value: boolean) => void;

  settingsTab: string;
  setSettingsTab: (value: string) => void;
  openSettings: (tab?: string) => void;

  showDebugOverlay: boolean;
  setShowDebugOverlay: (value: boolean) => void;

  eSportsModeEnabled: boolean;
  setESportsModeEnabled: (value: boolean) => void;

  inputMode: "voice_activity" | "push_to_talk";
  setInputMode: (value: "voice_activity" | "push_to_talk") => void;

  pushToTalkKey: string;
  setPushToTalkKey: (value: string) => void;
  muteHotkey: string;
  setMuteHotkey: (value: string) => void;
  deafenHotkey: string;
  setDeafenHotkey: (value: string) => void;
  disconnectHotkey: string;
  setDisconnectHotkey: (value: string) => void;

  showPeerLatency: boolean;
  setShowPeerLatency: (value: boolean) => void;

  notificationBadgeEnabled: boolean;
  setNotificationBadgeEnabled: (value: boolean) => void;

  messageSoundEnabled: boolean;
  setMessageSoundEnabled: (value: boolean) => void;
  messageSoundVolume: number;
  setMessageSoundVolume: (value: number) => void;
  customMessageSoundFile: string | null;
  setCustomMessageSoundFile: (value: string | null) => void;

  chatMediaVolume: number;
  setChatMediaVolume: (value: number) => void;

  cameraID: string;
  setCameraID: (id: string) => void;
  cameraQuality: string;
  setCameraQuality: (quality: string) => void;
  cameraMirrored: boolean;
  setCameraMirrored: (mirrored: boolean) => void;

  screenShareQuality: string;
  setScreenShareQuality: (quality: string) => void;

  userVolumes: Record<string, number>;
  updateUserVolume: (serverUserId: string, volume: number) => void;
  resetUserVolume: (serverUserId: string) => void;
}

// ── localStorage helpers ────────────────────────────────────────────

export function updateStorage(key: string, value: string, state: (d: string) => void) {
  state(value);
  localStorage.setItem(key, value);
}

export function updateRnnoiseEnabled(value: boolean, setter: (value: boolean) => void) {
  setter(value);
  localStorage.setItem("rnnoiseEnabled", value.toString());
}

export function readInitialMicID(): string | undefined {
  const stored = localStorage.getItem("micID");
  return (stored && stored !== "undefined" && stored.trim() !== "") ? stored : undefined;
}

export function readInitialMicVolume(): number {
  const stored = localStorage.getItem("micVolume");
  const value = stored ? Number(stored) : 50;
  if (value === 100) {
    localStorage.setItem("micVolume", "50");
    return 50;
  }
  return value;
}

// ── Singleton init value ────────────────────────────────────────────

export const settingsInit: Settings = {
  micID: readInitialMicID(),
  setMicID: () => {},
  micVolume: Number(localStorage.getItem("micVolume")) || 50,
  setMicVolume: () => {},
  outputVolume: Number(localStorage.getItem("outputVolume")) || 50,
  setOutputVolume: () => {},
  noiseGate: Number(localStorage.getItem("noiseGate")) || 10,
  setNoiseGate: () => {},
  loopbackEnabled: false,
  setLoopbackEnabled: () => {},
  rnnoiseEnabled: localStorage.getItem("rnnoiseEnabled") !== "false",
  setRnnoiseEnabled: () => {},
  autoGainEnabled: localStorage.getItem("autoGainEnabled") !== "false",
  setAutoGainEnabled: () => {},
  autoGainTargetDb: Number(localStorage.getItem("autoGainTargetDb")) || -20,
  setAutoGainTargetDb: () => {},
  compressorEnabled: localStorage.getItem("compressorEnabled") !== "false",
  setCompressorEnabled: () => {},
  compressorAmount: Number(localStorage.getItem("compressorAmount")) || 50,
  setCompressorAmount: () => {},
  isMuted: false,
  setIsMuted: () => {},
  isDeafened: false,
  setIsDeafened: () => {},
  showSettings: false,
  setShowSettings: () => {},
  showNickname: false,
  setShowNickname: () => {},
  nickname: localStorage.getItem("nickname") || "Unknown",
  setNickname: () => {},
  avatarDataUrl: null,
  setAvatarDataUrl: () => {},
  setAvatarFile: async () => {},
  hasSeenWelcome: !!localStorage.getItem("hasSeenWelcome"),
  updateHasSeenWelcome: () => {},
  showVoiceView: true,
  setShowVoiceView: () => {},

  pinChannelsSidebar: localStorage.getItem("pinChannelsSidebar") === "true",
  setPinChannelsSidebar: () => {},
  pinMembersSidebar: localStorage.getItem("pinMembersSidebar") === "true",
  setPinMembersSidebar: () => {},

  connectSoundEnabled: localStorage.getItem("connectSoundEnabled") !== "false",
  setConnectSoundEnabled: () => {},
  disconnectSoundEnabled: localStorage.getItem("disconnectSoundEnabled") !== "false",
  setDisconnectSoundEnabled: () => {},
  connectSoundVolume: Number(localStorage.getItem("connectSoundVolume")) || 10,
  setConnectSoundVolume: () => {},
  disconnectSoundVolume: Number(localStorage.getItem("disconnectSoundVolume")) || 10,
  setDisconnectSoundVolume: () => {},
  customConnectSoundFile: localStorage.getItem("customConnectSoundFile") || null,
  setCustomConnectSoundFile: () => {},
  customDisconnectSoundFile: localStorage.getItem("customDisconnectSoundFile") || null,
  setCustomDisconnectSoundFile: () => {},
  settingsTab: "profile",
  setSettingsTab: () => {},
  openSettings: () => {},
  isAFK: false,
  setIsAFK: () => {},
  afkTimeoutMinutes: 5,
  setAfkTimeoutMinutes: () => {},
  showDebugOverlay: localStorage.getItem("showDebugOverlay") === "true",
  setShowDebugOverlay: () => {},

  eSportsModeEnabled: localStorage.getItem("eSportsModeEnabled") === "true",
  setESportsModeEnabled: () => {},

  inputMode: (localStorage.getItem("inputMode") as "voice_activity" | "push_to_talk") || "voice_activity",
  setInputMode: () => {},

  pushToTalkKey: localStorage.getItem("pushToTalkKey") || "",
  setPushToTalkKey: () => {},
  muteHotkey: localStorage.getItem("muteHotkey") || "",
  setMuteHotkey: () => {},
  deafenHotkey: localStorage.getItem("deafenHotkey") || "",
  setDeafenHotkey: () => {},
  disconnectHotkey: localStorage.getItem("disconnectHotkey") || "",
  setDisconnectHotkey: () => {},

  showPeerLatency: localStorage.getItem("showPeerLatency") !== "false",
  setShowPeerLatency: () => {},

  notificationBadgeEnabled: localStorage.getItem("notificationBadgeEnabled") !== "false",
  setNotificationBadgeEnabled: () => {},

  messageSoundEnabled: localStorage.getItem("messageSoundEnabled") !== "false",
  setMessageSoundEnabled: () => {},
  messageSoundVolume: Number(localStorage.getItem("messageSoundVolume")) || 30,
  setMessageSoundVolume: () => {},
  customMessageSoundFile: localStorage.getItem("customMessageSoundFile") || null,
  setCustomMessageSoundFile: () => {},

  chatMediaVolume: Number(localStorage.getItem("chatMediaVolume")) || 50,
  setChatMediaVolume: () => {},

  cameraID: localStorage.getItem("cameraID") || "",
  setCameraID: () => {},
  cameraQuality: localStorage.getItem("cameraQuality") || "720p",
  setCameraQuality: () => {},
  cameraMirrored: localStorage.getItem("cameraMirrored") !== "false",
  setCameraMirrored: () => {},

  screenShareQuality: localStorage.getItem("screenShareQuality") || "native",
  setScreenShareQuality: () => {},

  userVolumes: JSON.parse(localStorage.getItem("userVolumes") || "{}"),
  updateUserVolume: () => {},
  resetUserVolume: () => {},
};
