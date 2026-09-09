import { useEffect, useRef, useState } from "react";

import { singletonHook } from "@/common";
import {
  clearStoredAvatar,
  getStoredAvatar,
  pickRandomName,
  setStoredAvatar,
  useUserId,
} from "@/common";

import { getElectronAPI, isElectron } from "../../../../lib/electron";
import type { VoiceTileLayout, VoiceTwoPersonLayout } from "./settingsStorage";
import { type ScalabilityMode, type ScreenShareCodec, settingsInit, type VideoCodec } from "./settingsStorage";
import { loadAudioFromCache, useAudioSettings } from "./useAudioSettings";
import { getUserValue, loadForUser, setUserValue } from "./userStorage";

/**
 * Per device, which is also what it means. `setUserValue` returns without
 * persisting when there is no user id, so a guest was greeted on every launch.
 */
const WELCOME_KEY = "gryt.hasSeenWelcome";

function readSeenWelcome(): boolean {
  try {
    if (localStorage.getItem(WELCOME_KEY) === "true") return true;
  } catch {
    // Unreadable storage means greet them. Showing it twice is a smaller
    // failure than never showing it at all.
  }
  // Anybody who dismissed it before this moved is not greeted again.
  return getUserValue<boolean>("hasSeenWelcome", false);
}

function writeSeenWelcome() {
  try {
    localStorage.setItem(WELCOME_KEY, "true");
  } catch {
    // Private mode or a full quota. It holds for this session and is gone next
    // launch, which is the safe way to lose it.
  }
}

function useSettingsHook() {
  const userId = useUserId();
  const audio = useAudioSettings();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("profile");
  const [showNickname, setShowNickname] = useState(false);
  const [hasSeenWelcome, setHasSeenWelcome] = useState(false);
  /** Until the load runs, every default is a guess — and `hasSeenWelcome`
      defaults to false, so the app is briefly certain everybody is new. */
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [showTour, setShowTour] = useState(false);

  const avatarObjectUrlRef = useRef<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrlState] = useState<string | null>(null);

  /** Off by default, because the essential controls sat between debug overlays.
      Reveals in place, so nothing somebody has seen before moves. */
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDebugOverlay, setShowDebugOverlay] = useState(false);
  const [showVideoDebugOverlay, setShowVideoDebugOverlay] = useState(false);
  const [nickname, setNickname] = useState("Unknown");
  const [activity, setActivity] = useState("");
  /* Pushed from the main process, the only side that can look. Empty until
     somebody lists something: the watcher does not poll for nothing. */
  const [playingNow, setPlayingNow] = useState<string[]>([]);
  const [showPeerLatency, setShowPeerLatency] = useState(true);
  /* Off, and the default is the decision: a toggle that starts on is not consent,
     it is something somebody has to find out about and turn off. */
  const [googleFontsEnabled, setGoogleFontsEnabled] = useState(false);
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
  const [voiceTwoPersonLayout, setVoiceTwoPersonLayout] =
    useState<VoiceTwoPersonLayout>("hero");
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

  const [officialServerHidden, setOfficialServerHiddenState] = useState(false);

  const [autoLoadEmbeds, setAutoLoadEmbedsState] = useState(false);
  const [micSilentWarningDismissed, setMicSilentWarningDismissedState] =
    useState(false);

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

      /** "Unknown" went out as the nickname on every join, and the avatar is
          seeded on the name, so all of them had one face. Written back. */
      const stored = getUserValue<string>("nickname", "");
      const name = stored || pickRandomName();
      if (!stored) setUserValue("nickname", name);
      setNickname(name);
      setHasSeenWelcome(readSeenWelcome());
      setActivity(getUserValue("activity", ""));
      setShowAdvanced(getUserValue("showAdvanced", false));
      setShowDebugOverlay(getUserValue("showDebugOverlay", false));
      setShowVideoDebugOverlay(getUserValue("showVideoDebugOverlay", false));
      setShowPeerLatency(getUserValue("showPeerLatency", true));
      setGoogleFontsEnabled(getUserValue("googleFontsEnabled", false));
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
      setVoiceTwoPersonLayout(
        getUserValue<VoiceTwoPersonLayout>("voiceTwoPersonLayout", "hero"),
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
      setOfficialServerHiddenState(getUserValue("officialServerHidden", false));
      setMicSilentWarningDismissedState(
        getUserValue("micSilentWarningDismissed", false),
      );
      setAutoLoadEmbedsState(
        getUserValue("autoLoadEmbeds", false),
      );
      setPinChannelsSidebarState(getUserValue("pinChannelsSidebar", true));
      setPinMembersSidebarState(getUserValue("pinMembersSidebar", true));
      setAfkTimeoutMinutes(getUserValue("afkTimeoutMinutes", 5));

      const seen = readSeenWelcome();
      setHasSeenWelcome(seen);
      // The tour rather than Settings opening on top of somebody. Once: this ran
      // on every load, so declining it was nagged at forever.
      if (
        seen &&
        !getUserValue<string>("nickname", "") &&
        !getUserValue<boolean>("hasSeenTour", false)
      ) {
        setShowTour(true);
      }

      // Here rather than at the end: everything the first-run decisions rest on is
      // read, and the avatar below is an await nobody is waiting on.
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

  /* Read once as well as subscribed: a window opened after a game started would
     otherwise wait for the next change, which is when it quits. */
  useEffect(() => {
    if (!isElectron()) return;
    const api = getElectronAPI();
    if (!api?.onWatchedProgramsChanged) return;

    let cancelled = false;
    void api.getRunningWatched?.().then((names) => {
      if (!cancelled) setPlayingNow(names);
    });

    const drop = api.onWatchedProgramsChanged((names) => {
      if (!cancelled) setPlayingNow(names);
    });

    return () => {
      cancelled = true;
      drop();
    };
  }, []);

  function updateNickname(newName: string) {
    setNickname(newName);
    setUserValue("nickname", newName);
  }

  function updateActivity(next: string) {
    setActivity(next);
    setUserValue("activity", next);
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

  function updateGoogleFontsEnabled(value: boolean) {
    setGoogleFontsEnabled(value);
    setUserValue("googleFontsEnabled", value);
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

  function updateVoiceTwoPersonLayout(layout: VoiceTwoPersonLayout) {
    setVoiceTwoPersonLayout(layout);
    setUserValue("voiceTwoPersonLayout", layout);
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

  /** An options object rather than a boolean: wired to `onOpenChange`, an event
      where a flag was expected reads as truthy, and here it reads as a skip. */
  function completeWelcome(options?: { startTour?: boolean }) {
    setHasSeenWelcome(true);
    writeSeenWelcome();

    if (options?.startTour === true) {
      if (
        !getUserValue<string>("nickname", "") &&
        !getUserValue<boolean>("hasSeenTour", false)
      ) {
        setShowTour(true);
      }
      return;
    }

    // Anything that is not asking for the tour declines it, and that has to be
    // written down: the load path offers it to exactly the person who said no.
    setUserValue("hasSeenTour", true);
  }

  /** Finishing and skipping are the same statement. Written down, so it is still
      true after a reload. */
  function dismissTour() {
    setShowTour(false);
    setUserValue("hasSeenTour", true);
  }

  function openSettings(tab: string = "appearance") {
    setSettingsTab(tab);
    setShowSettings(true);
  }

  /**
   * The same thing, for code that is not in the React tree. The socket layer is
   * plain modules; `server_settings_open` beside it already works this way.
   */
  useEffect(() => {
    const handler = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab;
      setSettingsTab(tab || "appearance");
      setShowSettings(true);
    };

    window.addEventListener("user_settings_open", handler);
    return () => window.removeEventListener("user_settings_open", handler);
  }, []);

  function updateOfficialServerHidden(hidden: boolean) {
    setOfficialServerHiddenState(hidden);
    setUserValue("officialServerHidden", hidden);
  }

  function updateAutoLoadEmbeds(value: boolean) {
    setAutoLoadEmbedsState(value);
    setUserValue("autoLoadEmbeds", value);
  }

  function updateMicSilentWarningDismissed(dismissed: boolean) {
    setMicSilentWarningDismissedState(dismissed);
    setUserValue("micSilentWarningDismissed", dismissed);
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
    activity,
    setActivity: updateActivity,
    /* A game wins while running and hands the line back when it stops. Only the
       first: a member list row is one line. */
    effectiveActivity: playingNow[0] ?? activity,
    playingNow,
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
    officialServerHidden,
    setOfficialServerHidden: updateOfficialServerHidden,

    autoLoadEmbeds,
    setAutoLoadEmbeds: updateAutoLoadEmbeds,
    micSilentWarningDismissed,
    setMicSilentWarningDismissed: updateMicSilentWarningDismissed,

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
    googleFontsEnabled,
    setGoogleFontsEnabled: updateGoogleFontsEnabled,
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
    voiceTwoPersonLayout,
    setVoiceTwoPersonLayout: updateVoiceTwoPersonLayout,
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
