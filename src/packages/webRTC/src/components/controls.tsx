import { IconButton, Tooltip } from "@gryt/ui";
import { getIsBrowserSupported, SFUConnectionState, useCamera, useScreenShare } from "@gryt/voice";
import { useSFU } from "@gryt/voice";
import { voiceLog } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";
import { useSockets } from "@/socket";
import { useServerPermissions } from "@/socket/src/hooks/usePermissions";

import { getElectronAPI } from "../../../../lib/electron";
import { PiMicrophoneFill, PiMicrophoneSlashFill, PiPhoneDisconnectFill, PiSignOutFill, PiSlidersHorizontalFill, PiSpeakerHighFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { screenAudioProblemMessage, screenAudioStreamId } from "../../../../lib/screenShareAudio";
import { useInACall } from "../adapters/inACall";
import { firstShareKey, shareMeta, useShareWindowsVersion } from "../adapters/shareWindows";
import { type AnnouncedShare, useExtraScreenWindows } from "../adapters/useExtraScreenWindows";
import { useScreenAudioMute } from "../adapters/useScreenAudioMute";
import { useScreenAudioSources } from "../adapters/useScreenAudioSources";
import { useVoiceSounds } from "../adapters/useVoiceSounds";
import { attachEncodedTransform, type EncodedTransformHandle, isEncodedTransformSupported } from "../utils/encodedTransform";
import { senderStreamId } from "../utils/senderStreamIds";
import { liftScreenCapture, screenSendSettings } from "../utils/streamQuality";
import { BAR_BUTTON_STYLE, BAR_SOLO_CLASS, CallControlButton, LEAVE_CLASS, SPLIT_BUTTON_CLASS, SplitControl } from "./CallControlButton";
import { CameraControl } from "./CameraControl";
import { controlState } from "./controlState";
import { HeadsetMenu } from "./HeadsetMenu";
import { MicMenu } from "./MicMenu";
import { ScreenAudioSourcesModal } from "./ScreenAudioSourcesModal";
import { ScreenShareControl } from "./ScreenShareControl";

interface ControlsProps {
  onDisconnect?: () => void;
}

/**
 * A tooltip that is absent rather than empty when it has nothing to say. Radix
 * renders the chrome even when `content` is undefined, leaving a blank bubble.
 */
function MaybeTooltip({
  content,
  children,
}: {
  content: string | null;
  children: React.ReactElement;
}) {
  if (!content) return children;
  return (
    <Tooltip title={content}>
      {children}
    </Tooltip>
  );
}


const BAR_SIZE = "large";
const BAR_ICON = 20;

export function Controls({ onDisconnect }: ControlsProps) {
  // A call is hung up; a voice channel is only left (GRYT-1785).
  const inACall = useInACall();
  const [isBrowserSupported] = useState(getIsBrowserSupported());
  const {
    disconnect,
    addVideoTrack,
    removeVideoTrack,
    addScreenVideoTrack,
    removeScreenVideoTrack,
    addScreenAudioTrack,
    removeScreenAudioTrack,
    isConnected,
    connectionState,
    currentServerConnected,
    currentChannelConnected,
    getPeerConnection,
    getScreenVideoSender,
    setVideoSendSettings,
  } = useSFU();
  const { playDisconnect } = useVoiceSounds();
  const { cameraStream, cameraEnabled, setCameraEnabled } = useCamera();
  const { screenVideoStream, screenAudioStream, screenShareActive, nativeAudioActive, nativeEncodedCodec, subscribeEncodedFrames, stopScreenShare } = useScreenShare();
  const { available: canMuteScreenAudio } = useScreenAudioMute();
  const { supported: canPickAudioSources } = useScreenAudioSources();
  const extraShares = useExtraScreenWindows();
  const extraSharesKey = JSON.stringify(extraShares);
  const shareVersion = useShareWindowsVersion();
  const [showAudioSourcesModal, setShowAudioSourcesModal] = useState(false);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [headsetMenuOpen, setHeadsetMenuOpen] = useState(false);
  const { sockets } = useSockets();
  const {
    setIsMuted, isMuted, isDeafened, setIsDeafened,
    isServerMuted, isServerDeafened,
    screenShareQuality,
    screenShareFps,
    screenShareGamingMode,
    screenShareCodec,
    screenShareMaxBitrate,
    screenShareScalabilityMode,
    cameraCodec,
  } = useSettings();

  const prevCameraStreamRef = useRef<MediaStream | null>(null);
  const prevScreenVideoRef = useRef<MediaStream | null>(null);
  const prevScreenAudioRef = useRef<MediaStream | null>(null);
  // Copies of senderStreamIds for the emits below. A layout change mounts a new Controls
  // mid-call, so these start empty and can't be the only record (GRYT-1319).
  const webrtcCameraStreamId = useRef<string | null>(null);
  const webrtcScreenVideoStreamId = useRef<string | null>(null);
  const webrtcScreenAudioStreamId = useRef<string | null>(null);
  // Getters through refs: as effect dependencies, voice 0.5.8's new-every-render getters re-ran
  // the camera effect four times a second, and each run reset the camera's scaling (GRYT-1333).
  const getPeerConnectionRef = useRef(getPeerConnection);
  getPeerConnectionRef.current = getPeerConnection;
  const getScreenVideoSenderRef = useRef(getScreenVideoSender);
  getScreenVideoSenderRef.current = getScreenVideoSender;
  const { canIn } = useServerPermissions(currentServerConnected || "");
  // The engine owns the encodings and merges these with what viewers draw (GRYT-1432).
  const setVideoSendSettingsRef = useRef(setVideoSendSettings);
  setVideoSendSettingsRef.current = setVideoSendSettings;
  const screenLiftChain = useRef<Promise<void>>(Promise.resolve());

  // Sync camera stream to WebRTC peer connection
  useEffect(() => {
    if (!isConnected) return;
    if (cameraEnabled && cameraStream) {
      const videoTrack = cameraStream.getVideoTracks()[0];
      if (videoTrack) {
        const isReplace = prevCameraStreamRef.current !== null && prevCameraStreamRef.current !== cameraStream;
        voiceLog.step("CAMERA", "sync", isReplace ? "Replacing camera track (quality change)" : "Adding camera track", {
          trackId: videoTrack.id,
          readyState: videoTrack.readyState,
          streamId: cameraStream.id,
          prevStreamId: prevCameraStreamRef.current?.id,
          settings: videoTrack.getSettings(),
        });
        addVideoTrack(videoTrack, cameraStream, cameraCodec);
        webrtcCameraStreamId.current = senderStreamId(getPeerConnectionRef.current?.(), "camera", cameraStream.id);
        prevCameraStreamRef.current = cameraStream;

        setVideoSendSettingsRef.current?.("camera", {
          priority: screenShareActive ? "low" : "medium",
          degradationPreference: "maintain-framerate",
        });
      }
    } else if (prevCameraStreamRef.current) {
      voiceLog.step("CAMERA", "sync", "Removing camera track", {
        prevStreamId: prevCameraStreamRef.current.id,
      });
      // Pauses the sender, so the camera comes back under the id senderStreamIds already has.
      removeVideoTrack();
      setVideoSendSettingsRef.current?.("camera", null);
      prevCameraStreamRef.current = null;
      webrtcCameraStreamId.current = null;
    }
  }, [cameraEnabled, cameraStream, isConnected, screenShareActive, addVideoTrack, removeVideoTrack, cameraCodec]);

  // Sync screen share video track to WebRTC
  useEffect(() => {
    if (!isConnected) return;
    if (screenShareActive && screenVideoStream) {
      const videoTrack = screenVideoStream.getVideoTracks()[0];
      if (videoTrack) {
        voiceLog.info("SCREEN", `controls: syncing video track=${videoTrack.id} stream=${screenVideoStream.id} prev=${prevScreenVideoRef.current?.id ?? "null"}`);
        addScreenVideoTrack(videoTrack, screenVideoStream, screenShareCodec);
        // Kept after the share stops: the engine pauses this sender rather than removing it.
        webrtcScreenVideoStreamId.current = senderStreamId(getPeerConnectionRef.current?.(), "screenVideo", screenVideoStream.id);
        prevScreenVideoRef.current = screenVideoStream;

        const quality = screenShareQuality;
        const fps = screenShareFps;
        const settings = screenSendSettings({
          quality, fps, gamingMode: screenShareGamingMode, codec: screenShareCodec,
          maxBitrate: screenShareMaxBitrate, scalabilityMode: screenShareScalabilityMode,
          nativeH264: nativeEncodedCodec === "h264",
        });
        voiceLog.info("SCREEN", `settings: maxBitrate=${settings.maxBitrate} maxFramerate=${fps} ceiling=${quality} scalabilityMode=${settings.scalabilityMode ?? "none"} degradationPreference=${settings.degradationPreference}`);
        // In order, so a quick second pick can't land before the first.
        screenLiftChain.current = screenLiftChain.current
          .then(() => liftScreenCapture(videoTrack, quality, fps))
          .then(() => setVideoSendSettingsRef.current?.("screen", settings));
      }
    } else if (prevScreenVideoRef.current) {
      voiceLog.info("SCREEN", `controls: removing video track, prevStream=${prevScreenVideoRef.current.id}`);
      removeScreenVideoTrack();
      setVideoSendSettingsRef.current?.("screen", null);
      prevScreenVideoRef.current = null;
    }
  }, [screenShareActive, screenVideoStream, isConnected, addScreenVideoTrack, removeScreenVideoTrack, screenShareQuality, screenShareFps, screenShareGamingMode, screenShareCodec, screenShareMaxBitrate, screenShareScalabilityMode, nativeEncodedCodec]);

  // Attach Encoded Transform when native H.264 encoding is active: injects
  // pre-encoded NALs, bypassing the browser's decode-re-encode cycle.
  const encodedTransformRef = useRef<EncodedTransformHandle | null>(null);

  useEffect(() => {
    if (encodedTransformRef.current) {
      encodedTransformRef.current.detach();
      encodedTransformRef.current = null;
    }

    if (!isConnected || !screenShareActive || !screenVideoStream || nativeEncodedCodec !== "h264") return;
    if (!isEncodedTransformSupported()) return;

    // The sync effect above has put this share's track on the sender by now.
    const sender = getScreenVideoSenderRef.current?.();
    if (!sender) return;

    const handle = attachEncodedTransform(sender);
    if (!handle) return;

    encodedTransformRef.current = handle;
    voiceLog.info("SCREEN", "Encoded Transform attached — bypassing WebRTC re-encode");

    const unsub = subscribeEncodedFrames((data, keyframe, timestamp) => {
      handle.feedFrame(data, keyframe, timestamp);
    });

    return () => {
      unsub();
      if (encodedTransformRef.current === handle) {
        handle.detach();
        encodedTransformRef.current = null;
        voiceLog.info("SCREEN", "Encoded Transform detached");
      }
    };
  }, [isConnected, screenShareActive, screenVideoStream, nativeEncodedCodec, subscribeEncodedFrames]);

  // Sync screen share audio track to WebRTC
  useEffect(() => {
    if (!isConnected) return;
    if (screenShareActive && screenAudioStream) {
      const audioTrack = screenAudioStream.getAudioTracks()[0];
      if (audioTrack) {
        voiceLog.info("SCREEN", `controls: syncing audio track=${audioTrack.id} label="${audioTrack.label}" enabled=${audioTrack.enabled} readyState=${audioTrack.readyState} muted=${audioTrack.muted} stream=${screenAudioStream.id}`);
        addScreenAudioTrack(audioTrack, screenAudioStream);
        webrtcScreenAudioStreamId.current = senderStreamId(getPeerConnectionRef.current?.(), "screenAudio", screenAudioStream.id);
        prevScreenAudioRef.current = screenAudioStream;
      } else {
        voiceLog.info("SCREEN", `controls: screenAudioStream present (id=${screenAudioStream.id}) but has NO audio tracks`);
      }
    } else if (prevScreenAudioRef.current) {
      voiceLog.info("SCREEN", `controls: removing audio track, prevStream=${prevScreenAudioRef.current.id}`);
      removeScreenAudioTrack();
      prevScreenAudioRef.current = null;
    }
  }, [screenShareActive, screenAudioStream, isConnected, addScreenAudioTrack, removeScreenAudioTrack]);

  // Log native audio capture status when screen share audio changes
  useEffect(() => {
    if (!screenShareActive || !screenAudioStream) return;
    const tracks = screenAudioStream.getAudioTracks();
    voiceLog.info("SCREEN", `controls: audio source → ${nativeAudioActive ? "NATIVE EXE CAPTURE" : "raw loopback / getDisplayMedia"}`, {
      streamId: screenAudioStream.id,
      trackCount: tracks.length,
      tracks: tracks.map(t => ({ id: t.id, label: t.label, readyState: t.readyState })),
    });
  }, [screenShareActive, screenAudioStream, nativeAudioActive]);

  // Delayed codec verification via getStats() — reports the actual codec once encoding starts
  useEffect(() => {
    if (!screenShareActive || !screenVideoStream) return;
    const timer = setTimeout(() => {
      const pc = getPeerConnectionRef.current?.();
      if (!pc) return;
      const videoTrack = screenVideoStream.getVideoTracks()[0];
      if (!videoTrack) return;
      const sender = pc.getSenders().find(s => s.track === videoTrack);
      if (!sender) return;
      sender.getStats().then(stats => {
        stats.forEach(report => {
          if (report.type === "outbound-rtp" && report.kind === "video") {
            const codecId = report.codecId;
            if (codecId) {
              stats.forEach(inner => {
                if (inner.id === codecId && inner.type === "codec") {
                  voiceLog.ok("SCREEN", "CODEC", `Active screen share codec: ${inner.mimeType} pt=${inner.payloadType} clockRate=${inner.clockRate} ${inner.sdpFmtpLine || ""}`, {
                    bytesSent: report.bytesSent,
                    framesSent: report.framesEncoded,
                    width: report.frameWidth,
                    height: report.frameHeight,
                  });
                }
              });
            }
          }
        });
      }).catch(() => { /* stats unavailable */ });
    }, 3000);
    return () => clearTimeout(timer);
  }, [screenShareActive, screenVideoStream]);

  /* The last camera and screen payloads this client sent, readable from a listener
     wired once that would otherwise close over whatever they were then. */
  const lastCameraStateRef = useRef<{ enabled: boolean; streamId: string } | null>(null);
  const lastScreenStateRef = useRef<{ enabled: boolean; videoStreamId: string; audioStreamId: string; shares?: AnnouncedShare[] } | null>(null);

  // Emit camera state to server
  useEffect(() => {
    if (!isConnected || !currentServerConnected) return;
    const socket = sockets[currentServerConnected];
    const payload = {
      enabled: cameraEnabled,
      streamId: cameraEnabled
        ? webrtcCameraStreamId.current || cameraStream?.id || ""
        : "",
    };
    lastCameraStateRef.current = payload;
    if (socket) {
      socket.emit("voice:camera:state", payload);
    }
  }, [cameraEnabled, cameraStream, isConnected, currentServerConnected, sockets]);

  // Emit screen share state to server
  useEffect(() => {
    if (!isConnected || !currentServerConnected) return;
    const socket = sockets[currentServerConnected];
    if (socket) {
      const first: AnnouncedShare = {
        videoStreamId: (screenShareActive && webrtcScreenVideoStreamId.current) || screenVideoStream?.id || "",
        audioStreamId: screenAudioStreamId(screenShareActive, screenAudioStream, webrtcScreenAudioStreamId.current),
        name: shareMeta(firstShareKey())?.name,
      };
      const extra: AnnouncedShare[] = JSON.parse(extraSharesKey);
      // Older servers read the single pair; `shares` carries every window and its name.
      const payload = { enabled: screenShareActive, videoStreamId: first.videoStreamId, audioStreamId: first.audioStreamId, ...(screenShareActive ? { shares: [first, ...extra] } : {}) };
      lastScreenStateRef.current = payload;
      voiceLog.info("SCREEN", `controls: emitting voice:screen:state`, payload);
      if (screenShareActive && !payload.audioStreamId) {
        voiceLog.info("SCREEN", `controls: WARNING – screen share active but audioStreamId is empty (no audio captured)`);
      }
      socket.emit("voice:screen:state", payload);
    }
  }, [screenShareActive, screenVideoStream, screenAudioStream, isConnected, currentServerConnected, sockets, extraSharesKey, shareVersion]);

  /* Re-announce camera and screen after a reconnect, on `voice:room:granted` and
     not on the reconnect itself: permissions are not cached yet (GRYT-612). */
  useEffect(() => {
    if (!currentServerConnected) return;
    const host = currentServerConnected;
    const onReconnected = (event: Event) => {
      const detail = (event as CustomEvent<{ host?: string }>).detail;
      if (detail?.host && detail.host !== host) return;
      const socket = sockets[host];
      if (!socket) return;
      socket.once("voice:room:granted", () => {
        if (lastCameraStateRef.current) {
          socket.emit("voice:camera:state", lastCameraStateRef.current);
        }
        if (lastScreenStateRef.current) {
          socket.emit("voice:screen:state", lastScreenStateRef.current);
        }
      });
    };
    window.addEventListener("server_socket_reconnected", onReconnected);
    return () => window.removeEventListener("server_socket_reconnected", onReconnected);
  }, [currentServerConnected, sockets]);

  /* A reconnect builds a new peer connection, so the saved ids go with the old one. The camera
     and screen stop only when the call has ended, or the reconnect comes back without them. */
  useEffect(() => {
    if (isConnected) return;
    webrtcCameraStreamId.current = null;
    webrtcScreenVideoStreamId.current = null;
    webrtcScreenAudioStreamId.current = null;
    if (connectionState !== SFUConnectionState.DISCONNECTED) return;
    if (cameraEnabled) setCameraEnabled(false);
    if (screenShareActive) stopScreenShare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, connectionState]);

  /* A permission taken mid-call. The SFU has already stopped forwarding it, so the
     call bar follows. Only on a change: joining a channel without it is not news. */
  const mayShareVideo = canIn(currentChannelConnected, "share_video");
  const mayShareScreen = canIn(currentChannelConnected, "share_screen");
  const maySpeak = canIn(currentChannelConnected, "speak");
  const lastMay = useRef<{ channel: string | null; video: boolean; screen: boolean; speak: boolean } | null>(null);
  useEffect(() => {
    const prev = lastMay.current;
    lastMay.current = isConnected
      ? { channel: currentChannelConnected, video: mayShareVideo, screen: mayShareScreen, speak: maySpeak }
      : null;
    if (!prev || !isConnected || prev.channel !== currentChannelConnected) return;
    if (prev.video && !mayShareVideo && cameraEnabled) {
      setCameraEnabled(false);
      toast.error("You can't share video in this channel any more, so your camera is off.", { id: "share-video-taken" });
    }
    if (prev.screen && !mayShareScreen && screenShareActive) {
      stopScreenShare();
      toast.error("You can't share your screen in this channel any more, so the share stopped.", { id: "share-screen-taken" });
    }
    if (prev.speak && !maySpeak && !isMuted) {
      setIsMuted(true);
      toast.error("You can't speak in this channel any more, so you're muted.", { id: "speak-taken" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, currentChannelConnected, mayShareVideo, mayShareScreen, maySpeak]);

  useEffect(() => {
    return getElectronAPI()?.onNativeAudioProblem?.((problem) => {
      const message = screenAudioProblemMessage(problem);
      if (message) toast.error(message, { id: "screen-audio-problem", duration: 12000 });
    });
  }, []);

  function handleMute() {
    if (isServerMuted) {
      toast("You are server muted by an admin.", { icon: <PiMicrophoneSlashFill size={18} />, id: "server-muted" });
      return;
    }
    setIsMuted(!isMuted);
  }

  function handleDeafen() {
    if (isServerDeafened) {
      toast("You are server deafened by an admin.", { icon: <PiSpeakerSlashFill size={18} />, id: "server-deafened" });
      return;
    }
    setIsDeafened(!isDeafened);
  }

  function handleDisconnect() {
    // Camera and screen share are stopped inside disconnect(), so every way of
    // leaving gets it rather than just the ones with a button. GRYT-305.
    playDisconnect();
    disconnect(onDisconnect);
  }

  return (
    <>
      {isBrowserSupported && (
        // 48px targets (Fitts); below 400px, where Electron windows can go, they wrap and close up.
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {/*
            Every control here is icon-only, so the tooltip text is also the
            accessible name — without aria-label a screen reader announced five
            bare "button"s and could not tell muting from leaving the call.

            The tooltip is rendered conditionally rather than being handed
            `content={cond ? "..." : undefined}`. Radix still renders the
            tooltip chrome when content is undefined, so the normal state showed
            an empty bubble on hover and kept it anchored to whichever control
            you hovered previously.
          */}
          <SplitControl
            state={controlState(isServerMuted, isMuted)}
            arrowOpen={micMenuOpen}
            arrow={<MicMenu state={controlState(isServerMuted, isMuted)} open={micMenuOpen} onOpenChange={setMicMenuOpen} />}
          >
            <MaybeTooltip content={isServerMuted ? "Server muted by admin" : null}>
              <CallControlButton
                size={BAR_SIZE}
                style={BAR_BUTTON_STYLE}
                state={controlState(isServerMuted, isMuted)}
                idleClassName={SPLIT_BUTTON_CLASS}
                aria-label={(isMuted || isServerMuted) ? "Unmute microphone" : "Mute microphone"}
                onClick={handleMute}
              >
                {(isMuted || isServerMuted) ? <PiMicrophoneSlashFill size={BAR_ICON} /> : <PiMicrophoneFill size={BAR_ICON} />}
              </CallControlButton>
            </MaybeTooltip>
          </SplitControl>

          <SplitControl
            state={controlState(isServerDeafened, isDeafened)}
            arrowOpen={headsetMenuOpen}
            arrow={<HeadsetMenu state={controlState(isServerDeafened, isDeafened)} open={headsetMenuOpen} onOpenChange={setHeadsetMenuOpen} />}
          >
            <MaybeTooltip content={isServerDeafened ? "Server deafened by admin" : null}>
              <CallControlButton
                size={BAR_SIZE}
                style={BAR_BUTTON_STYLE}
                state={controlState(isServerDeafened, isDeafened)}
                idleClassName={SPLIT_BUTTON_CLASS}
                aria-label={(isDeafened || isServerDeafened) ? "Undeafen" : "Deafen"}
                onClick={handleDeafen}
              >
                {(isDeafened || isServerDeafened) ? <PiSpeakerSlashFill size={BAR_ICON} /> : <PiSpeakerHighFill size={BAR_ICON} />}
              </CallControlButton>
            </MaybeTooltip>
          </SplitControl>

          <CameraControl split size={BAR_SIZE} iconSize={BAR_ICON} allowed={canIn(currentChannelConnected, "share_video")} />

          <ScreenShareControl size={BAR_SIZE} buttonStyle={BAR_BUTTON_STYLE} idleClassName={BAR_SOLO_CLASS} iconSize={BAR_ICON} allowed={canIn(currentChannelConnected, "share_screen")} takesRailPress />

          {/* Only where the OS can take audio per application, which is Windows. */}
          {canMuteScreenAudio && canPickAudioSources && (
            <Tooltip title="Choose which apps you're sharing audio from">
              <IconButton tone="neutral" size={BAR_SIZE} style={BAR_BUTTON_STYLE} className={BAR_SOLO_CLASS}
                aria-label="Choose which apps you're sharing audio from"
                onClick={() => setShowAudioSourcesModal(true)}
              >
                <PiSlidersHorizontalFill size={BAR_ICON} />
              </IconButton>
            </Tooltip>
          )}

          {/* The only solid red in the bar, so it reads as leaving rather than as another toggle. */}
          <Tooltip title={inACall ? "Hang up" : "Leave"}>
            <CallControlButton
              size={BAR_SIZE}
              style={BAR_BUTTON_STYLE}
              state="idle"
              className={LEAVE_CLASS}
              aria-label={inACall ? "Hang up" : "Leave voice channel"}
              onClick={handleDisconnect}
            >
              {inACall ? <PiPhoneDisconnectFill size={BAR_ICON} /> : <PiSignOutFill size={BAR_ICON} />}
            </CallControlButton>
          </Tooltip>
        </div>
      )}

      <ScreenAudioSourcesModal
        open={showAudioSourcesModal}
        onOpenChange={setShowAudioSourcesModal}
      />
    </>
  );
}
