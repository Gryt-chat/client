import { Flex, IconButton } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
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

import { estimateBitrate, getIsBrowserSupported, useCamera, useScreenShare } from "@/audio";
import type { ScreenShareQuality } from "@/audio";
import { useSettings } from "@/settings";
import { useSockets } from "@/socket";
import { useSFU } from "@/webRTC";

import { isElectron } from "../../../../lib/electron";
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
    screenShareQuality, setScreenShareQuality,
    screenShareFps, setScreenShareFps,
    experimentalScreenShare,
    cameraID, setCameraID, cameraQuality, setCameraQuality,
    cameraMirrored, setCameraMirrored,
  } = useSettings();

  const prevCameraStreamRef = useRef<MediaStream | null>(null);
  const prevScreenVideoRef = useRef<MediaStream | null>(null);
  const prevScreenAudioRef = useRef<MediaStream | null>(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showScreenShareModal, setShowScreenShareModal] = useState(false);

  // Sync camera stream to WebRTC peer connection
  useEffect(() => {
    if (!isConnected) return;
    if (cameraEnabled && cameraStream) {
      const videoTrack = cameraStream.getVideoTracks()[0];
      if (videoTrack) {
        addVideoTrack(videoTrack, cameraStream);
        prevCameraStreamRef.current = cameraStream;
      }
    } else if (prevCameraStreamRef.current) {
      removeVideoTrack();
      prevCameraStreamRef.current = null;
    }
  }, [cameraEnabled, cameraStream, isConnected, addVideoTrack, removeVideoTrack]);

  // Sync screen share video track to WebRTC
  useEffect(() => {
    if (!isConnected) return;
    if (screenShareActive && screenVideoStream) {
      const videoTrack = screenVideoStream.getVideoTracks()[0];
      if (videoTrack) {
        addScreenVideoTrack(videoTrack, screenVideoStream);
        prevScreenVideoRef.current = screenVideoStream;

        const bitrate = estimateBitrate(screenShareQuality as ScreenShareQuality, screenShareFps);
        if (bitrate && getPeerConnection) {
          const pc = getPeerConnection();
          if (pc) {
            const senders = pc.getSenders();
            const screenSender = senders.find(s => s.track === videoTrack);
            if (screenSender) {
              const params = screenSender.getParameters();
              if (params.encodings && params.encodings.length > 0) {
                params.encodings[0].maxBitrate = bitrate;
                screenSender.setParameters(params).catch(() => {});
              }
            }
          }
        }
      }
    } else if (prevScreenVideoRef.current) {
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
        addScreenAudioTrack(audioTrack, screenAudioStream);
        prevScreenAudioRef.current = screenAudioStream;
      }
    } else if (prevScreenAudioRef.current) {
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
      socket.emit("voice:screen:state", {
        enabled: screenShareActive,
        videoStreamId: screenVideoStream?.id || "",
        audioStreamId: screenAudioStream?.id || "",
      });
    }
  }, [screenShareActive, screenVideoStream, screenAudioStream, isConnected, currentServerConnected, sockets]);

  // Stop camera and screen share on disconnect
  useEffect(() => {
    if (!isConnected) {
      if (cameraEnabled) setCameraEnabled(false);
      if (screenShareActive) stopScreenShare();
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
    setIsMuted(!isMuted);
  }

  function handleDeafen() {
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
          <IconButton
            color={isMuted ? "red" : "gray"}
            variant="soft"
            onClick={handleMute}
          >
            {isMuted ? <MdMicOff size={16} /> : <MdMic size={16} />}
          </IconButton>

          <IconButton
            color={isDeafened ? "red" : "gray"}
            variant="soft"
            onClick={handleDeafen}
          >
            {isDeafened ? <MdVolumeOff size={16} /> : <MdVolumeUp size={16} />}
          </IconButton>

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
