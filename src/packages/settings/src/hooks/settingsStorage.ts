import { AUDIO_DEFAULTS } from "./useAudioSettings";

export type ScreenShareCodec = "auto" | "h264" | "vp9" | "av1";

export interface Settings {
  micID?: string;
  setMicID: (id: string) => void;
  outputDeviceID: string;
  setOutputDeviceID: (id: string) => void;
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
  isServerMuted: boolean;
  setIsServerMuted: (value: boolean) => void;
  isServerDeafened: boolean;
  setIsServerDeafened: (value: boolean) => void;

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

  blurProfanity: boolean;
  setBlurProfanity: (enabled: boolean) => void;

  smileyConversion: boolean;
  setSmileyConversion: (enabled: boolean) => void;
  disabledSmileys: ReadonlySet<string>;
  setDisabledSmileys: (shortcodes: ReadonlySet<string>) => void;

  cameraID: string;
  setCameraID: (id: string) => void;
  cameraQuality: string;
  setCameraQuality: (quality: string) => void;
  cameraMirrored: boolean;
  setCameraMirrored: (mirrored: boolean) => void;
  cameraFlipped: boolean;
  setCameraFlipped: (flipped: boolean) => void;

  screenShareQuality: string;
  setScreenShareQuality: (quality: string) => void;
  screenShareFps: number;
  setScreenShareFps: (fps: number) => void;
  experimentalScreenShare: boolean;
  setExperimentalScreenShare: (enabled: boolean) => void;

  screenShareGamingMode: boolean;
  setScreenShareGamingMode: (enabled: boolean) => void;

  screenShareCodec: ScreenShareCodec;
  setScreenShareCodec: (codec: ScreenShareCodec) => void;

  /** 0 = auto (estimated from quality/fps), otherwise manual value in bps */
  screenShareMaxBitrate: number;
  setScreenShareMaxBitrate: (bps: number) => void;

  userVolumes: Record<string, number>;
  updateUserVolume: (serverUserId: string, volume: number) => void;
  resetUserVolume: (serverUserId: string) => void;
}

// ── Singleton init value (defaults before user data is loaded) ──────

const noop = () => {};

export const settingsInit: Settings = {
  micID: AUDIO_DEFAULTS.micID,
  setMicID: noop,
  outputDeviceID: AUDIO_DEFAULTS.outputDeviceID,
  setOutputDeviceID: noop,
  micVolume: AUDIO_DEFAULTS.micVolume,
  setMicVolume: noop,
  outputVolume: AUDIO_DEFAULTS.outputVolume,
  setOutputVolume: noop,
  noiseGate: AUDIO_DEFAULTS.noiseGate,
  setNoiseGate: noop,
  loopbackEnabled: false,
  setLoopbackEnabled: noop,
  rnnoiseEnabled: AUDIO_DEFAULTS.rnnoiseEnabled,
  setRnnoiseEnabled: noop,
  autoGainEnabled: AUDIO_DEFAULTS.autoGainEnabled,
  setAutoGainEnabled: noop,
  autoGainTargetDb: AUDIO_DEFAULTS.autoGainTargetDb,
  setAutoGainTargetDb: noop,
  compressorEnabled: AUDIO_DEFAULTS.compressorEnabled,
  setCompressorEnabled: noop,
  compressorAmount: AUDIO_DEFAULTS.compressorAmount,
  setCompressorAmount: noop,
  isMuted: false,
  setIsMuted: noop,
  isDeafened: false,
  setIsDeafened: noop,
  isServerMuted: false,
  setIsServerMuted: noop,
  isServerDeafened: false,
  setIsServerDeafened: noop,
  showSettings: false,
  setShowSettings: noop,
  showNickname: false,
  setShowNickname: noop,
  nickname: "Unknown",
  setNickname: noop,
  avatarDataUrl: null,
  setAvatarDataUrl: noop,
  setAvatarFile: async () => {},
  hasSeenWelcome: false,
  updateHasSeenWelcome: noop,
  showVoiceView: true,
  setShowVoiceView: noop,

  pinChannelsSidebar: true,
  setPinChannelsSidebar: noop,
  pinMembersSidebar: true,
  setPinMembersSidebar: noop,

  connectSoundEnabled: AUDIO_DEFAULTS.connectSoundEnabled,
  setConnectSoundEnabled: noop,
  disconnectSoundEnabled: AUDIO_DEFAULTS.disconnectSoundEnabled,
  setDisconnectSoundEnabled: noop,
  connectSoundVolume: AUDIO_DEFAULTS.connectSoundVolume,
  setConnectSoundVolume: noop,
  disconnectSoundVolume: AUDIO_DEFAULTS.disconnectSoundVolume,
  setDisconnectSoundVolume: noop,
  customConnectSoundFile: AUDIO_DEFAULTS.customConnectSoundFile,
  setCustomConnectSoundFile: noop,
  customDisconnectSoundFile: AUDIO_DEFAULTS.customDisconnectSoundFile,
  setCustomDisconnectSoundFile: noop,
  settingsTab: "profile",
  setSettingsTab: noop,
  openSettings: noop,
  isAFK: false,
  setIsAFK: noop,
  afkTimeoutMinutes: 5,
  setAfkTimeoutMinutes: noop,
  showDebugOverlay: false,
  setShowDebugOverlay: noop,

  eSportsModeEnabled: AUDIO_DEFAULTS.eSportsModeEnabled,
  setESportsModeEnabled: noop,

  inputMode: AUDIO_DEFAULTS.inputMode,
  setInputMode: noop,

  pushToTalkKey: AUDIO_DEFAULTS.pushToTalkKey,
  setPushToTalkKey: noop,
  muteHotkey: AUDIO_DEFAULTS.muteHotkey,
  setMuteHotkey: noop,
  deafenHotkey: AUDIO_DEFAULTS.deafenHotkey,
  setDeafenHotkey: noop,
  disconnectHotkey: AUDIO_DEFAULTS.disconnectHotkey,
  setDisconnectHotkey: noop,

  showPeerLatency: true,
  setShowPeerLatency: noop,

  notificationBadgeEnabled: AUDIO_DEFAULTS.notificationBadgeEnabled,
  setNotificationBadgeEnabled: noop,

  messageSoundEnabled: AUDIO_DEFAULTS.messageSoundEnabled,
  setMessageSoundEnabled: noop,
  messageSoundVolume: AUDIO_DEFAULTS.messageSoundVolume,
  setMessageSoundVolume: noop,
  customMessageSoundFile: AUDIO_DEFAULTS.customMessageSoundFile,
  setCustomMessageSoundFile: noop,

  chatMediaVolume: 50,
  setChatMediaVolume: noop,

  blurProfanity: true,
  setBlurProfanity: noop,

  smileyConversion: true,
  setSmileyConversion: noop,
  disabledSmileys: new Set<string>(),
  setDisabledSmileys: noop,

  cameraID: "",
  setCameraID: noop,
  cameraQuality: "native",
  setCameraQuality: noop,
  cameraMirrored: true,
  setCameraMirrored: noop,
  cameraFlipped: false,
  setCameraFlipped: noop,

  screenShareQuality: "native",
  setScreenShareQuality: noop,
  screenShareFps: 30,
  setScreenShareFps: noop,
  experimentalScreenShare: false,
  setExperimentalScreenShare: noop,

  screenShareGamingMode: true,
  setScreenShareGamingMode: noop,

  screenShareCodec: "auto",
  setScreenShareCodec: noop,

  screenShareMaxBitrate: 0,
  setScreenShareMaxBitrate: noop,

  userVolumes: {},
  updateUserVolume: noop,
  resetUserVolume: noop,
};
