import { Flex, IconButton, Tooltip } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  MdCallEnd,
  MdMic,
  MdMicOff,
  MdScreenShare,
  MdStopScreenShare,
  MdVideocam,
  MdVideocamOff,
  MdVolumeOff,
  MdVolumeUp,
} from "react-icons/md";

import { estimateBitrate, getIsBrowserSupported, type ScreenShareQuality,useCamera, useScreenShare } from "@/audio";
import { useSettings } from "@/settings";
import { useSockets } from "@/socket";
import { useSFU } from "@/webRTC";

import { isElectron } from "../../../../lib/electron";
import { voiceLog } from "../hooks/voiceLogger";
import { CameraPreviewModal } from "./CameraPreviewModal";
import { ScreenSharePickerModal } from "./ScreenSharePickerModal";

interface ControlsProps {
  onDisconnect?: () => void;
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
  } = useSFU();
  const { cameraStream, cameraEnabled, setCameraEnabled } = useCamera();
  const { screenVideoStream, screenAudioStream, screenShareActive, startScreenShare, stopScreenShare } = useScreenShare();
  const { sockets } = useSockets();
  const {
    setIsMuted, isMuted, isDeafened, setIsDeafened,
    isServerMuted, isServerDeafened,
    screenShareQuality, setScreenShareQuality,
    screenShareFps, setScreenShareFps,
    experimentalScreenShare,
    cameraID, setCameraID, cameraQuality, setCameraQuality,
    cameraMirrored, setCameraMirrored,
    cameraFlipped, setCameraFlipped,
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
        addVideoTrack(videoTrack, cameraStream);
        prevCameraStreamRef.current = cameraStream;

        if (getPeerConnection) {
          const pc = getPeerConnection();
          if (pc) {
            const senders = pc.getSenders();
            const cameraSender = senders.find(s => s.track === videoTrack);
            if (cameraSender) {
              const params = cameraSender.getParameters();
              params.degradationPreference = "maintain-framerate";
              cameraSender.setParameters(params).catch(() => {});
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
  }, [cameraEnabled, cameraStream, isConnected, addVideoTrack, removeVideoTrack, getPeerConnection]);

  // Sync screen share video track to WebRTC
  useEffect(() => {
    if (!isConnected) return;
    if (screenShareActive && screenVideoStream) {
      const videoTrack = screenVideoStream.getVideoTracks()[0];
      if (videoTrack) {
        voiceLog.info("SCREEN", `controls: syncing video track=${videoTrack.id} stream=${screenVideoStream.id} prev=${prevScreenVideoRef.current?.id ?? "null"}`);
        addScreenVideoTrack(videoTrack, screenVideoStream);
        if (!webrtcScreenVideoStreamId.current) {
          webrtcScreenVideoStreamId.current = screenVideoStream.id;
        }
        prevScreenVideoRef.current = screenVideoStream;

        const bitrate = estimateBitrate(screenShareQuality as ScreenShareQuality, screenShareFps);
        if (bitrate && getPeerConnection) {
          const pc = getPeerConnection();
          if (pc) {
            const senders = pc.getSenders();
            const screenSender = senders.find(s => s.track === videoTrack);
            if (screenSender) {
              const params = screenSender.getParameters();
              params.degradationPreference = "maintain-framerate";
              if (params.encodings && params.encodings.length > 0) {
                params.encodings[0].maxBitrate = bitrate;
              }
              screenSender.setParameters(params).catch(() => {});
            }
          }
        }
      }
    } else if (prevScreenVideoRef.current) {
      voiceLog.info("SCREEN", `controls: removing video track, prevStream=${prevScreenVideoRef.current.id}`);
      removeScreenVideoTrack();
      prevScreenVideoRef.current = null;
    }
  }, [screenShareActive, screenVideoStream, isConnected, addScreenVideoTrack, removeScreenVideoTrack, screenShareQuality, screenShareFps, getPeerConnection]);

  // Sync screen share audio track to WebRTC
  useEffect(() => {
    if (!isConnected) return;
    if (screenShareActive && screenAudioStream) {
      const audioTrack = screenAudioStream.getAudioTracks()[0];
      if (audioTrack) {
        voiceLog.info("SCREEN", `controls: syncing audio track=${audioTrack.id} enabled=${audioTrack.enabled} readyState=${audioTrack.readyState} muted=${audioTrack.muted} stream=${screenAudioStream.id}`);
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
          <Tooltip content={isServerMuted ? "Server muted by admin" : undefined} delayDuration={300}>
            <IconButton
              color={(isMuted || isServerMuted) ? "red" : "gray"}
              variant="soft"
              onClick={handleMute}
              style={isServerMuted ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              {(isMuted || isServerMuted) ? <MdMicOff size={16} /> : <MdMic size={16} />}
            </IconButton>
          </Tooltip>

          <Tooltip content={isServerDeafened ? "Server deafened by admin" : undefined} delayDuration={300}>
            <IconButton
              color={(isDeafened || isServerDeafened) ? "red" : "gray"}
              variant="soft"
              onClick={handleDeafen}
              style={isServerDeafened ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              {(isDeafened || isServerDeafened) ? <MdVolumeOff size={16} /> : <MdVolumeUp size={16} />}
            </IconButton>
          </Tooltip>

          <IconButton
            color={cameraEnabled ? "green" : "gray"}
            variant="soft"
            onClick={handleCameraClick}
          >
            {cameraEnabled ? <MdVideocam size={16} /> : <MdVideocamOff size={16} />}
          </IconButton>

          <IconButton
            color={screenShareActive ? "red" : "gray"}
            variant="soft"
            onClick={handleScreenShareClick}
          >
            {screenShareActive ? <MdStopScreenShare size={16} /> : <MdScreenShare size={16} />}
          </IconButton>

          <IconButton variant="soft" color="red" onClick={handleDisconnect}>
            <MdCallEnd size={16} />
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
        onStart={({ sourceId, withAudio }) => startScreenShare(withAudio, sourceId)}
      />
    </>
  );
}
