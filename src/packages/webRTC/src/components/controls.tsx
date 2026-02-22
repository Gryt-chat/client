import { Checkbox, DropdownMenu, Flex, IconButton, Text } from "@radix-ui/themes";
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

import { getIsBrowserSupported, useCamera, useScreenShare } from "@/audio";
import { QUALITY_BITRATES, ScreenShareQuality } from "@/audio/src/hooks/useScreenShare";
import { useSettings } from "@/settings";
import { useSockets } from "@/socket";
import { useSFU } from "@/webRTC";

interface ControlsProps {
  onDisconnect?: () => void;
}

const QUALITY_LABELS: Record<ScreenShareQuality, string> = {
  native: "Native",
  "1080p": "1080p",
  "720p": "720p",
  "480p": "480p",
};

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
  const { setIsMuted, isMuted, isDeafened, setIsDeafened, screenShareQuality, setScreenShareQuality } = useSettings();

  const prevCameraStreamRef = useRef<MediaStream | null>(null);
  const prevScreenVideoRef = useRef<MediaStream | null>(null);
  const prevScreenAudioRef = useRef<MediaStream | null>(null);
  const [includeAudio, setIncludeAudio] = useState(true);

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

        const bitrate = QUALITY_BITRATES[screenShareQuality as ScreenShareQuality];
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
  }, [screenShareActive, screenVideoStream, isConnected, addScreenVideoTrack, removeScreenVideoTrack, screenShareQuality, getPeerConnection]);

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

  const handleToggleCamera = useCallback(() => {
    setCameraEnabled(!cameraEnabled);
  }, [cameraEnabled, setCameraEnabled]);

  const handleStartScreenShare = useCallback(() => {
    startScreenShare(includeAudio);
  }, [startScreenShare, includeAudio]);

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
            onClick={handleToggleCamera}
          >
            {cameraEnabled ? <MdVideocam size={16} /> : <MdVideocamOff size={16} />}
          </IconButton>

          {screenShareActive ? (
            <IconButton
              color="red"
              variant="soft"
              onClick={stopScreenShare}
            >
              <MdStopScreenShare size={16} />
            </IconButton>
          ) : (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <IconButton color="gray" variant="soft">
                  <MdScreenShare size={16} />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content side="top" align="center">
                <DropdownMenu.Label>Screen Share</DropdownMenu.Label>

                <DropdownMenu.Item onClick={handleStartScreenShare}>
                  Share Screen
                </DropdownMenu.Item>

                <DropdownMenu.Separator />

                <Text as="label" size="1" style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", cursor: "pointer" }}>
                  <Checkbox
                    size="1"
                    checked={includeAudio}
                    onCheckedChange={(v) => setIncludeAudio(v === true)}
                  />
                  Include audio
                </Text>

                <DropdownMenu.Separator />

                <DropdownMenu.Label>Quality</DropdownMenu.Label>
                {(Object.keys(QUALITY_LABELS) as ScreenShareQuality[]).map((q) => (
                  <DropdownMenu.CheckboxItem
                    key={q}
                    checked={screenShareQuality === q}
                    onCheckedChange={() => setScreenShareQuality(q)}
                  >
                    {QUALITY_LABELS[q]}
                  </DropdownMenu.CheckboxItem>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}

          <IconButton variant="soft" color="red" onClick={handleDisconnect}>
            <MdCallEnd size={16} />
          </IconButton>
        </Flex>
      )}
    </>
  );
}
