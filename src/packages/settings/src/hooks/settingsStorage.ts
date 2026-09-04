import { AUDIO_DEFAULTS } from "./useAudioSettings";

/**
 * How the voice grid chooses its rows and columns.
 *
 * "meet" reproduces Google Meet, measured: more columns, tiles allowed to go
 * portrait. "large" picks whatever arrangement gives the biggest tiles, which
 * at nine people is a 3x3 of wide tiles where Meet gives 4+5. Both look
 * correct, so it is a setting rather than a decision baked into the layout.
 */
export type VoiceTileLayout = "meet" | "large";

/**
 * What two people in a channel look like.
 *
 * "hero" is what a video call usually does and what Gryt has always done: one
 * camera fills the panel, the other sits in the corner. "equal" gives them the
 * same tile, which is better when you are both doing something rather than
 * talking to each other.
 */
export type VoiceTwoPersonLayout = "hero" | "equal";

export type VideoCodec = "auto" | "h264" | "vp9" | "av1";
/** @deprecated Use VideoCodec instead */
export type ScreenShareCodec = VideoCodec;
export type ScalabilityMode = "L1T1" | "L1T2" | "L1T3";

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
  noiseGateRelease: number;
  setNoiseGateRelease: (ms: number) => void;
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
  /**
   * Whether the stored settings have been read yet.
   *
   * Anything deciding whether to show a first-run thing has to wait for this.
   * The defaults here say "new user" because that is the only safe default for
   * a value nobody has set, and a first-run dialog cannot tell that apart from
   * a genuine new user without being told.
   */
  settingsLoaded: boolean;
  completeWelcome: (options?: { startTour?: boolean }) => void;
  /** The first-run coach-mark tour, shown in place of force-opening Settings. */
  showTour: boolean;
  dismissTour: () => void;

  showVoiceView: boolean;
  setShowVoiceView: (value: boolean) => void;

  /**
   * Whether the row offering the server we run has been hidden.
   *
   * Per device rather than per account, like the other preferences here.
   * Which servers somebody declined is a UI choice, and the identity service
   * has no business learning it.
   */
  officialServerHidden: boolean;
  setOfficialServerHidden: (value: boolean) => void;

  /**
   * Whether the "microphone is not picking up any sound" toast has been turned
   * off for good.
   *
   * Per device, because the thing it is wrong about is a device: a headset that
   * gates its own noise floor emits digital silence between sentences, which is
   * exactly what the detector looks for. Somebody on that headset wants the
   * warning gone here and still wants it on the laptop.
   */
  micSilentWarningDismissed: boolean;
  setMicSilentWarningDismissed: (value: boolean) => void;

  pinChannelsSidebar: boolean;
  setPinChannelsSidebar: (value: boolean) => void;
  pinMembersSidebar: boolean;
  setPinMembersSidebar: (value: boolean) => void;

  settingsTab: string;
  setSettingsTab: (value: string) => void;
  openSettings: (tab?: string) => void;

  /** Reveal the settings most people should not have to see. */
  showAdvanced: boolean;
  setShowAdvanced: (show: boolean) => void;
  showDebugOverlay: boolean;
  setShowDebugOverlay: (value: boolean) => void;
  showVideoDebugOverlay: boolean;
  setShowVideoDebugOverlay: (value: boolean) => void;

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
  /* Whether a theme may fetch a typeface from Google. Per machine, not part
     of the theme: a theme says which face it wants, this says whether this
     install will go and get one. In the theme it would let a shared link turn
     on network access for whoever opened it. */
  googleFontsEnabled: boolean;
  setShowPeerLatency: (value: boolean) => void;
  setGoogleFontsEnabled: (value: boolean) => void;

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
  faceFramingEnabled: boolean;
  setFaceFramingEnabled: (enabled: boolean) => void;
  voiceTileLayout: VoiceTileLayout;
  setVoiceTileLayout: (layout: VoiceTileLayout) => void;
  voiceTwoPersonLayout: VoiceTwoPersonLayout;
  setVoiceTwoPersonLayout: (layout: VoiceTwoPersonLayout) => void;
  devFakeParticipants: number;
  setDevFakeParticipants: (count: number) => void;
  devFakeMembers: number;
  setDevFakeMembers: (count: number) => void;
  devFakeChatSeconds: number;
  setDevFakeChatSeconds: (seconds: number) => void;
  devFakeMuted: number;
  setDevFakeMuted: (count: number) => void;
  devFakeScreenShare: boolean;
  setDevFakeScreenShare: (enabled: boolean) => void;
  devFakeDeafened: boolean;
  setDevFakeDeafened: (enabled: boolean) => void;
  devFakeSpeaking: boolean;
  setDevFakeSpeaking: (enabled: boolean) => void;
  cameraFlipped: boolean;
  setCameraFlipped: (flipped: boolean) => void;
  cameraFps: number;
  setCameraFps: (fps: number) => void;
  cameraCodec: VideoCodec;
  setCameraCodec: (codec: VideoCodec) => void;

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

  screenShareScalabilityMode: ScalabilityMode;
  setScreenShareScalabilityMode: (mode: ScalabilityMode) => void;

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
  noiseGateRelease: AUDIO_DEFAULTS.noiseGateRelease,
  setNoiseGateRelease: noop,
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
  // False in the fallback context too. A consumer rendering outside the
  // provider has certainly not had settings loaded for it.
  settingsLoaded: false,
  completeWelcome: noop,
  showTour: false,
  dismissTour: noop,
  showVoiceView: true,
  setShowVoiceView: noop,

  officialServerHidden: false,
  setOfficialServerHidden: noop,

  micSilentWarningDismissed: false,
  setMicSilentWarningDismissed: noop,

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
  showAdvanced: false,
  setShowAdvanced: () => {},
  showDebugOverlay: false,
  setShowDebugOverlay: noop,
  showVideoDebugOverlay: false,
  setShowVideoDebugOverlay: noop,

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
  googleFontsEnabled: false,
  setShowPeerLatency: noop,
  setGoogleFontsEnabled: noop,

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
  faceFramingEnabled: false,
  setFaceFramingEnabled: noop,
  voiceTileLayout: "meet",
  setVoiceTileLayout: noop,
  voiceTwoPersonLayout: "hero",
  setVoiceTwoPersonLayout: noop,
  devFakeParticipants: 0,
  setDevFakeParticipants: noop,
  devFakeMembers: 0,
  setDevFakeMembers: noop,
  devFakeChatSeconds: 6,
  setDevFakeChatSeconds: noop,
  devFakeMuted: 0,
  setDevFakeMuted: noop,
  devFakeScreenShare: false,
  setDevFakeScreenShare: noop,
  devFakeDeafened: false,
  setDevFakeDeafened: noop,
  devFakeSpeaking: true,
  setDevFakeSpeaking: noop,
  cameraFlipped: false,
  setCameraFlipped: noop,
  cameraFps: 30,
  setCameraFps: noop,
  cameraCodec: "auto",
  setCameraCodec: noop,

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

  screenShareScalabilityMode: "L1T3",
  setScreenShareScalabilityMode: noop,

  userVolumes: {},
  updateUserVolume: noop,
  resetUserVolume: noop,
};
