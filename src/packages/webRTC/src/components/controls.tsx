import { IconButton, Tooltip } from "@gryt/ui";
import { Flex } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiScanSmileyFill } from "react-icons/pi";
import { PiMicrophoneFill, PiMicrophoneSlashFill, PiMonitorArrowUpFill, PiPhoneDisconnectFill, PiScreencastFill, PiSpeakerHighFill, PiSpeakerSlashFill, PiVideoCameraFill, PiVideoCameraSlashFill } from "react-icons/pi";

import { estimateBitrate, getIsBrowserSupported, type ScreenShareQuality,useCamera, useScreenShare } from "@/audio";
import { useSettings } from "@/settings";
import { useSockets } from "@/socket";
import { useVideoFraming } from "@/socket/src/hooks/useVideoFraming";
import { useSFU } from "@/webRTC";

import { isElectron } from "../../../../lib/electron";
import { voiceLog } from "../hooks/voiceLogger";
import { attachEncodedTransform, type EncodedTransformHandle, isEncodedTransformSupported } from "../utils/encodedTransform";
import { CameraPreviewModal } from "./CameraPreviewModal";
import { ScreenSharePickerModal } from "./ScreenSharePickerModal";

interface ControlsProps {
  onDisconnect?: () => void;
}

/**
 * A tooltip that is absent rather than empty when it has nothing to say.
 *
 * Radix renders the tooltip chrome even when `content` is undefined, so
 * `content={cond ? "..." : undefined}` produced a blank bubble on every hover
 * in the normal state — and left it anchored to the previously hovered control.
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
    currentServerConnected,
    getPeerConnection,
    getScreenVideoSender,
  } = useSFU();
  const { cameraStream, cameraEnabled, setCameraEnabled } = useCamera();
  const { screenVideoStream, screenAudioStream, screenShareActive, nativeAudioActive, nativeScreenCaptureAvailable, nativeEncodedCodec, subscribeEncodedFrames, startScreenShare, stopScreenShare } = useScreenShare();
  const { sockets } = useSockets();
  const { recentre: recentreFace, detecting: detectingFace } = useVideoFraming();
  const {
    setIsMuted, isMuted, isDeafened, setIsDeafened,
    isServerMuted, isServerDeafened,
    screenShareQuality, setScreenShareQuality,
    screenShareFps, setScreenShareFps,
    experimentalScreenShare,
    screenShareGamingMode, setScreenShareGamingMode,
    screenShareCodec, setScreenShareCodec,
    screenShareMaxBitrate, setScreenShareMaxBitrate,
    screenShareScalabilityMode, setScreenShareScalabilityMode,
    cameraID, setCameraID, cameraQuality, setCameraQuality,
    cameraFps, setCameraFps,
    cameraMirrored, setCameraMirrored,
    cameraFlipped, setCameraFlipped,
    cameraCodec,
  } = useSettings();

  const prevCameraStreamRef = useRef<MediaStream | null>(null);
  const prevScreenVideoRef = useRef<MediaStream | null>(null);
  const prevScreenAudioRef = useRef<MediaStream | null>(null);
  const webrtcScreenVideoStreamId = useRef<string | null>(null);
  const webrtcScreenAudioStreamId = useRef<string | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showScreenShareModal, setShowScreenShareModal] = useState(false);

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
        prevCameraStreamRef.current = cameraStream;

        if (getPeerConnection) {
          const pc = getPeerConnection();
          if (pc) {
            const senders = pc.getSenders();
            const cameraSender = senders.find(s => s.track === videoTrack);
            if (cameraSender) {
              const params = cameraSender.getParameters();
              params.degradationPreference = "maintain-framerate";
              cameraSender.setParameters(params).catch((err: unknown) => {
                voiceLog.warn("CAMERA", `setParameters failed: ${err}`);
              });
            }
          }
        }
      }
    } else if (prevCameraStreamRef.current) {
      voiceLog.step("CAMERA", "sync", "Removing camera track", {
        prevStreamId: prevCameraStreamRef.current.id,
      });
      removeVideoTrack();
      prevCameraStreamRef.current = null;
    }
  }, [cameraEnabled, cameraStream, isConnected, addVideoTrack, removeVideoTrack, getPeerConnection, cameraCodec]);

  // Sync screen share video track to WebRTC
  useEffect(() => {
    if (!isConnected) return;
    if (screenShareActive && screenVideoStream) {
      const videoTrack = screenVideoStream.getVideoTracks()[0];
      if (videoTrack) {
        voiceLog.info("SCREEN", `controls: syncing video track=${videoTrack.id} stream=${screenVideoStream.id} prev=${prevScreenVideoRef.current?.id ?? "null"}`);
        addScreenVideoTrack(videoTrack, screenVideoStream, screenShareCodec);
        if (!webrtcScreenVideoStreamId.current) {
          webrtcScreenVideoStreamId.current = screenVideoStream.id;
        }
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
        if (getPeerConnection) {
          const pc = getPeerConnection();
          if (pc) {
            const senders = pc.getSenders();
            const screenSender = senders.find(s => s.track === videoTrack);
            if (screenSender) {
              const params = screenSender.getParameters();
              params.degradationPreference = "maintain-framerate";
              if (params.encodings && params.encodings.length > 0) {
                const effectiveBitrate = bitrate ?? 50_000_000;
                params.encodings[0].maxBitrate = effectiveBitrate;
                params.encodings[0].maxFramerate = screenShareFps;
                const isH264 = screenShareCodec === "h264" || (!screenShareCodec || screenShareCodec === "auto");
                if (!isH264 && screenShareScalabilityMode !== "L1T1") {
                  params.encodings[0].scalabilityMode = screenShareScalabilityMode;
                }
              }
              const enc = params.encodings[0];
              voiceLog.info("SCREEN", `setParameters: maxFramerate=${enc?.maxFramerate} maxBitrate=${enc?.maxBitrate} scalabilityMode=${enc?.scalabilityMode ?? "none"} degradationPreference=${params.degradationPreference}`);
              screenSender.setParameters(params).catch((err: unknown) => {
                voiceLog.warn("SCREEN", `setParameters failed: ${err}`);
              });
            }
          }
        }
      }
    } else if (prevScreenVideoRef.current) {
      voiceLog.info("SCREEN", `controls: removing video track, prevStream=${prevScreenVideoRef.current.id}`);
      removeScreenVideoTrack();
      prevScreenVideoRef.current = null;
    }
  }, [screenShareActive, screenVideoStream, isConnected, addScreenVideoTrack, removeScreenVideoTrack, screenShareQuality, screenShareFps, screenShareGamingMode, screenShareCodec, screenShareMaxBitrate, screenShareScalabilityMode, getPeerConnection]);

  // Attach Encoded Transform when native H.264 encoding is active.
  // Injects pre-encoded H.264 NALs directly into the WebRTC pipeline,
  // bypassing the browser's internal decode→re-encode cycle.
  const encodedTransformRef = useRef<EncodedTransformHandle | null>(null);

  useEffect(() => {
    if (encodedTransformRef.current) {
      encodedTransformRef.current.detach();
      encodedTransformRef.current = null;
    }

    if (!screenShareActive || nativeEncodedCodec !== "h264") return;
    if (!isEncodedTransformSupported()) return;

    const sender = getScreenVideoSender?.();
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
  }, [screenShareActive, nativeEncodedCodec, getScreenVideoSender, subscribeEncodedFrames]);

  // Sync screen share audio track to WebRTC
  useEffect(() => {
    if (!isConnected) return;
    if (screenShareActive && screenAudioStream) {
      const audioTrack = screenAudioStream.getAudioTracks()[0];
      if (audioTrack) {
        voiceLog.info("SCREEN", `controls: syncing audio track=${audioTrack.id} label="${audioTrack.label}" enabled=${audioTrack.enabled} readyState=${audioTrack.readyState} muted=${audioTrack.muted} stream=${screenAudioStream.id}`);
        addScreenAudioTrack(audioTrack, screenAudioStream);
        if (!webrtcScreenAudioStreamId.current) {
          webrtcScreenAudioStreamId.current = screenAudioStream.id;
        }
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
    if (!screenShareActive || !screenVideoStream || !getPeerConnection) return;
    const timer = setTimeout(() => {
      const pc = getPeerConnection();
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
  }, [screenShareActive, screenVideoStream, getPeerConnection]);

  // Emit camera state to server
  useEffect(() => {
    if (!isConnected || !currentServerConnected) return;
    const socket = sockets[currentServerConnected];
    if (socket) {
      socket.emit("voice:camera:state", {
        enabled: cameraEnabled,
        streamId: cameraStream?.id || "",
      });
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
        audioStreamId: (screenShareActive && webrtcScreenAudioStreamId.current) || screenAudioStream?.id || "",
      };
      voiceLog.info("SCREEN", `controls: emitting voice:screen:state`, payload);
      if (screenShareActive && !payload.audioStreamId) {
        voiceLog.info("SCREEN", `controls: WARNING – screen share active but audioStreamId is empty (no audio captured)`);
      }
      socket.emit("voice:screen:state", payload);
    }
  }, [screenShareActive, screenVideoStream, screenAudioStream, isConnected, currentServerConnected, sockets]);

  // Stop camera and screen share on disconnect; reset the saved WebRTC stream
  // IDs so the next voice session creates fresh sender transceivers.
  useEffect(() => {
    if (!isConnected) {
      if (cameraEnabled) setCameraEnabled(false);
      if (screenShareActive) stopScreenShare();
      webrtcScreenVideoStreamId.current = null;
      webrtcScreenAudioStreamId.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const handleCameraClick = useCallback(() => {
    if (cameraEnabled) {
      setCameraEnabled(false);
    } else {
      setShowCameraModal(true);
    }
  }, [cameraEnabled, setCameraEnabled]);

  const handleScreenShareClick = useCallback(() => {
    if (screenShareActive) {
      stopScreenShare();
    } else if (isElectron()) {
      setShowScreenShareModal(true);
    } else {
      setShowScreenShareModal(true);
    }
  }, [screenShareActive, stopScreenShare]);

  function handleMute() {
    if (isServerMuted) {
      toast("You are server muted by an admin.", { icon: "🔇", id: "server-muted" });
      return;
    }
    setIsMuted(!isMuted);
  }

  function handleDeafen() {
    if (isServerDeafened) {
      toast("You are server deafened by an admin.", { icon: "🔇", id: "server-deafened" });
      return;
    }
    setIsDeafened(!isDeafened);
  }

  function handleDisconnect() {
    if (cameraEnabled) setCameraEnabled(false);
    if (screenShareActive) stopScreenShare();
    disconnect(true, onDisconnect);
  }

  return (
    <>
      {isBrowserSupported && (
        <Flex align="center" justify="center" gap="4">
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
            <IconButton tone="neutral" size="xsmall"
              aria-label={(isMuted || isServerMuted) ? "Unmute microphone" : "Mute microphone"}
              onClick={handleMute}
              style={isServerMuted ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              {(isMuted || isServerMuted) ? <PiMicrophoneSlashFill size={16} /> : <PiMicrophoneFill size={16} />}
            </IconButton>
          </MaybeTooltip>

          <MaybeTooltip content={isServerDeafened ? "Server deafened by admin" : null}>
            <IconButton tone="neutral" size="xsmall"
              aria-label={(isDeafened || isServerDeafened) ? "Undeafen" : "Deafen"}
              onClick={handleDeafen}
              style={isServerDeafened ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              {(isDeafened || isServerDeafened) ? <PiSpeakerSlashFill size={16} /> : <PiSpeakerHighFill size={16} />}
            </IconButton>
          </MaybeTooltip>

          <IconButton tone="neutral" size="xsmall"
            aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
            onClick={handleCameraClick}
          >
            {cameraEnabled ? <PiVideoCameraFill size={16} /> : <PiVideoCameraSlashFill size={16} />}
          </IconButton>

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

          <IconButton tone="neutral" size="xsmall"
            aria-label={screenShareActive ? "Stop sharing your screen" : "Share your screen"}
            onClick={handleScreenShareClick}
          >
            {screenShareActive ? <PiMonitorArrowUpFill size={16} /> : <PiScreencastFill size={16} />}
          </IconButton>

          <IconButton tone="danger" size="xsmall" aria-label="Leave voice channel" onClick={handleDisconnect}>
            <PiPhoneDisconnectFill size={16} />
          </IconButton>
        </Flex>
      )}

      <CameraPreviewModal
        open={showCameraModal}
        onOpenChange={setShowCameraModal}
        cameraID={cameraID}
        onCameraIDChange={setCameraID}
        quality={cameraQuality}
        onQualityChange={setCameraQuality}
        fps={cameraFps}
        onFpsChange={setCameraFps}
        mirrored={cameraMirrored}
        onMirroredChange={setCameraMirrored}
        flipped={cameraFlipped}
        onFlippedChange={setCameraFlipped}
        onStart={() => setCameraEnabled(true)}
      />

      <ScreenSharePickerModal
        open={showScreenShareModal}
        onOpenChange={setShowScreenShareModal}
        quality={screenShareQuality as ScreenShareQuality}
        onQualityChange={setScreenShareQuality}
        fps={screenShareFps}
        onFpsChange={setScreenShareFps}
        experimentalScreenShare={experimentalScreenShare}
        gamingMode={screenShareGamingMode}
        onGamingModeChange={setScreenShareGamingMode}
        codec={screenShareCodec}
        onCodecChange={setScreenShareCodec}
        maxBitrate={screenShareMaxBitrate}
        onMaxBitrateChange={setScreenShareMaxBitrate}
        scalabilityMode={screenShareScalabilityMode}
        onScalabilityModeChange={setScreenShareScalabilityMode}
        nativeScreenCaptureAvailable={nativeScreenCaptureAvailable}
        onStart={({ sourceId, withAudio }) => startScreenShare(withAudio, sourceId)}
      />
    </>
  );
}
