import { IconButton, Tooltip } from "@gryt/ui";
import { estimateBitrate, getIsBrowserSupported, type ScreenShareQuality, SFUConnectionState, useCamera, useScreenShare } from "@gryt/voice";
import { useSFU } from "@gryt/voice";
import { voiceLog } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";
import { useSockets } from "@/socket";
import { useServerPermissions } from "@/socket/src/hooks/usePermissions";
import { useVideoFraming } from "@/socket/src/hooks/useVideoFraming";

import { getElectronAPI } from "../../../../lib/electron";
import { PiMicrophoneFill, PiMicrophoneSlashFill, PiPhoneDisconnectFill, PiScanSmileyFill, PiSlidersHorizontalFill, PiSpeakerHighFill, PiSpeakerSimpleHighFill, PiSpeakerSimpleSlashFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { screenAudioProblemMessage, screenAudioStreamId } from "../../../../lib/screenShareAudio";
import { useScreenAudioMute } from "../adapters/useScreenAudioMute";
import { useScreenAudioSources } from "../adapters/useScreenAudioSources";
import { useVoiceSounds } from "../adapters/useVoiceSounds";
import { attachEncodedTransform, type EncodedTransformHandle, isEncodedTransformSupported } from "../utils/encodedTransform";
import { roleSender, senderStreamId } from "../utils/senderStreamIds";
import { liftScreenCapture, qualityBox, setSizeCeiling, supportsDownTo } from "../utils/streamQuality";
import { CallControlButton, LEAVE_CLASS } from "./CallControlButton";
import { CameraControl } from "./CameraControl";
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

export function Controls({ onDisconnect }: ControlsProps) {
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
  } = useSFU();
  const { playDisconnect } = useVoiceSounds();
  const { cameraStream, cameraEnabled, setCameraEnabled } = useCamera();
  const { screenVideoStream, screenAudioStream, screenShareActive, nativeAudioActive, nativeEncodedCodec, subscribeEncodedFrames, stopScreenShare } = useScreenShare();
  const { muted: screenAudioMuted, available: canMuteScreenAudio, setMuted: setScreenAudioMuted } = useScreenAudioMute();
  const { supported: canPickAudioSources } = useScreenAudioSources();
  const [showAudioSourcesModal, setShowAudioSourcesModal] = useState(false);
  const { sockets } = useSockets();
  const { recentre: recentreFace, detecting: detectingFace } = useVideoFraming();
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
  // One setParameters at a time: a second read before the first write lands is refused.
  const screenParamsChain = useRef<Promise<void>>(Promise.resolve());

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

        const pc = getPeerConnectionRef.current?.();
        if (pc) {
          const cameraSender = roleSender(pc, "camera", videoTrack);
          if (cameraSender) {
            const params = cameraSender.getParameters();
            params.degradationPreference = "maintain-framerate";
            if (params.encodings && params.encodings.length > 0) {
              params.encodings[0].priority = screenShareActive ? "low" : "medium";
            }
            const priority = params.encodings?.[0]?.priority ?? "default";
            voiceLog.info(
              "CAMERA",
              `setParameters: priority=${priority} degradationPreference=${params.degradationPreference}`,
            );
            cameraSender.setParameters(params).catch((err: unknown) => {
              voiceLog.warn("CAMERA", `setParameters failed: ${err}`);
            });
          }
        }
      }
    } else if (prevCameraStreamRef.current) {
      voiceLog.step("CAMERA", "sync", "Removing camera track", {
        prevStreamId: prevCameraStreamRef.current.id,
      });
      // Pauses the sender, so the camera comes back under the id senderStreamIds already has.
      removeVideoTrack();
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

        let bitrate: number | null;
        if (screenShareMaxBitrate > 0) {
          bitrate = screenShareMaxBitrate;
        } else {
          bitrate = estimateBitrate(screenShareQuality as ScreenShareQuality, screenShareFps);
          if (bitrate && screenShareGamingMode) {
            bitrate = Math.min(Math.round(bitrate * 1.5), 50_000_000);
          }
        }
        /* **Asked for by name, not looked up by track.** A `getSenders()` lookup
         * matches only on the first share, so the cap stays too small (GRYT-13). */
        const screenSender = getScreenVideoSenderRef.current?.() ?? null;
        if (screenSender) {
          const quality = screenShareQuality;
          const fps = screenShareFps;
          const apply = async () => {
            await liftScreenCapture(videoTrack, quality, fps);
            const hasDownTo = await supportsDownTo(screenSender);
            const params = screenSender.getParameters();
            params.degradationPreference = screenShareGamingMode
              ? "maintain-framerate"
              : "maintain-resolution";
            if (params.encodings && params.encodings.length > 0) {
              const effectiveBitrate = bitrate ?? 50_000_000;
              params.encodings[0].priority = "high";
              params.encodings[0].maxBitrate = effectiveBitrate;
              params.encodings[0].maxFramerate = fps;
              setSizeCeiling(params.encodings[0], qualityBox(quality), videoTrack, hasDownTo);
              const isH264 = screenShareCodec === "h264" || (!screenShareCodec || screenShareCodec === "auto");
              if (!isH264 && screenShareScalabilityMode !== "L1T1") {
                params.encodings[0].scalabilityMode = screenShareScalabilityMode;
              }
            }
            const enc = params.encodings[0];
            voiceLog.info("SCREEN", `setParameters: priority=${enc?.priority ?? "default"} maxFramerate=${enc?.maxFramerate} maxBitrate=${enc?.maxBitrate} ceiling=${quality} scalabilityMode=${enc?.scalabilityMode ?? "none"} degradationPreference=${params.degradationPreference}`);
            await screenSender.setParameters(params);
          };
          screenParamsChain.current = screenParamsChain.current
            .then(apply)
            .catch((err: unknown) => {
              voiceLog.warn("SCREEN", `setParameters failed: ${err}`);
            });
        } else {
          // Worth a line rather than nothing: this is the state the bug sat in
          // silently, and it is still reachable if the engine has no sender yet.
          voiceLog.warn("SCREEN", "No screen video sender — encoding parameters not applied");
        }
      }
    } else if (prevScreenVideoRef.current) {
      voiceLog.info("SCREEN", `controls: removing video track, prevStream=${prevScreenVideoRef.current.id}`);
      removeScreenVideoTrack();
      prevScreenVideoRef.current = null;
    }
  }, [screenShareActive, screenVideoStream, isConnected, addScreenVideoTrack, removeScreenVideoTrack, screenShareQuality, screenShareFps, screenShareGamingMode, screenShareCodec, screenShareMaxBitrate, screenShareScalabilityMode]);

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
  const lastScreenStateRef = useRef<{ enabled: boolean; videoStreamId: string; audioStreamId: string } | null>(null);

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
      const payload = {
        enabled: screenShareActive,
        videoStreamId: (screenShareActive && webrtcScreenVideoStreamId.current) || screenVideoStream?.id || "",
        audioStreamId: screenAudioStreamId(screenShareActive, screenAudioStream, webrtcScreenAudioStreamId.current),
      };
      lastScreenStateRef.current = payload;
      voiceLog.info("SCREEN", `controls: emitting voice:screen:state`, payload);
      if (screenShareActive && !payload.audioStreamId) {
        voiceLog.info("SCREEN", `controls: WARNING – screen share active but audioStreamId is empty (no audio captured)`);
      }
      socket.emit("voice:screen:state", payload);
    }
  }, [screenShareActive, screenVideoStream, screenAudioStream, isConnected, currentServerConnected, sockets]);

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
        // Seven 32px controls at gap-4 are 320px, wider than the 300px window Electron allows.
        <div className="flex flex-wrap items-center justify-center gap-2 min-[400px]:gap-4">
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
          <MaybeTooltip content={isServerMuted ? "Server muted by admin" : null}>
            <CallControlButton
              state={isServerMuted ? "blocked" : isMuted ? "off" : "idle"}
              aria-label={(isMuted || isServerMuted) ? "Unmute microphone" : "Mute microphone"}
              onClick={handleMute}
            >
              {(isMuted || isServerMuted) ? <PiMicrophoneSlashFill size={16} /> : <PiMicrophoneFill size={16} />}
            </CallControlButton>
          </MaybeTooltip>

          <MaybeTooltip content={isServerDeafened ? "Server deafened by admin" : null}>
            <CallControlButton
              state={isServerDeafened ? "blocked" : isDeafened ? "off" : "idle"}
              aria-label={(isDeafened || isServerDeafened) ? "Undeafen" : "Deafen"}
              onClick={handleDeafen}
            >
              {(isDeafened || isServerDeafened) ? <PiSpeakerSlashFill size={16} /> : <PiSpeakerHighFill size={16} />}
            </CallControlButton>
          </MaybeTooltip>

          <CameraControl allowed={canIn(currentChannelConnected, "share_video")} />

          {/* Only while the camera is on, because that is the only time it can
              do anything, and next to the camera button because that is what
              it acts on. The setting decides whether this also happens by
              itself; the button is here so it never has to be found. */}
          {cameraEnabled && (
            <Tooltip title="Center my face">
              <IconButton tone="neutral" size="xsmall"
                aria-label="Center my face"
                disabled={detectingFace}
                onClick={() => void recentreFace()}
              >
                <PiScanSmileyFill size={16} />
              </IconButton>
            </Tooltip>
          )}

          <ScreenShareControl allowed={canIn(currentChannelConnected, "share_screen")} />

          {/* Next to the share button because that is what it acts on, and
              only while a share is actually carrying audio. */}
          {canMuteScreenAudio && (
            <Tooltip title={screenAudioMuted ? "Unmute the audio you're sharing" : "Mute the audio you're sharing"}>
              <CallControlButton
                state={screenAudioMuted ? "off" : "idle"}
                aria-label={screenAudioMuted ? "Unmute the audio you're sharing" : "Mute the audio you're sharing"}
                onClick={() => setScreenAudioMuted(!screenAudioMuted)}
              >
                {screenAudioMuted ? <PiSpeakerSimpleSlashFill size={16} /> : <PiSpeakerSimpleHighFill size={16} />}
              </CallControlButton>
            </Tooltip>
          )}

          {/* Only where the OS can take audio per application, which is
              Windows. Everywhere else the mute above is the whole story. */}
          {canMuteScreenAudio && canPickAudioSources && (
            <Tooltip title="Choose which apps you're sharing audio from">
              <IconButton tone="neutral" size="xsmall"
                aria-label="Choose which apps you're sharing audio from"
                onClick={() => setShowAudioSourcesModal(true)}
              >
                <PiSlidersHorizontalFill size={16} />
              </IconButton>
            </Tooltip>
          )}

          <IconButton tone="danger" size="xsmall" className={LEAVE_CLASS} aria-label="Leave voice channel" onClick={handleDisconnect}>
            <PiPhoneDisconnectFill size={16} />
          </IconButton>
        </div>
      )}

      <ScreenAudioSourcesModal
        open={showAudioSourcesModal}
        onOpenChange={setShowAudioSourcesModal}
      />
    </>
  );
}
