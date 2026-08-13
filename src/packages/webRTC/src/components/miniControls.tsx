import { IconButton } from "@gryt/ui";
import { AnimatePresence, motion, Variants } from "motion/react";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { PiMicrophoneFill, PiMicrophoneSlashFill, PiMonitorArrowUpFill, PiPhoneDisconnectFill, PiScreencastFill, PiSpeakerHighFill, PiSpeakerSlashFill, PiVideoCameraFill, PiVideoCameraSlashFill } from "react-icons/pi";

import { type ScreenShareQuality,useCamera, useScreenShare } from "@/audio";
import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";

import { useSFU } from "../hooks/useSFU";
import { CameraPreviewModal } from "./CameraPreviewModal";
import { ScreenSharePickerModal } from "./ScreenSharePickerModal";

const buttonAnimations: Variants = {
  hidden: { opacity: 0, x: -15, transition: { duration: 0.1 } },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.2,
      staggerChildren: 0.075,
      staggerDirection: 0,
      ease: "backOut",
    },
  },
};

export function MiniControls({
  direction = "row",
}: {
  direction: "row" | "column";
}) {
  const {
    isMuted,
    setIsMuted,
    isDeafened,
    showVoiceView,
    setIsDeafened,
    isServerMuted,
    isServerDeafened,
  } = useSettings();
  
  const {
    currentlyViewingServer,
  } = useServerManagement();

  const {
    currentServerConnected,
    disconnect,
    isConnected,
  } = useSFU();

  const { cameraEnabled, setCameraEnabled } = useCamera();
  const { screenShareActive, nativeScreenCaptureAvailable, startScreenShare, stopScreenShare } = useScreenShare();
  const {
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
  } = useSettings();

  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showScreenShareModal, setShowScreenShareModal] = useState(false);

  const handleCameraClick = useCallback(() => {
    if (cameraEnabled) setCameraEnabled(false);
    else setShowCameraModal(true);
  }, [cameraEnabled, setCameraEnabled]);

  const handleScreenShareClick = useCallback(() => {
    if (screenShareActive) stopScreenShare();
    else setShowScreenShareModal(true);
  }, [screenShareActive, stopScreenShare]);

  const isColumn = direction === "column";
  const iconSize = isColumn ? 14 : 12;

  return (
    <>
    <AnimatePresence>
      {isConnected &&
        (currentlyViewingServer?.host !== currentServerConnected ||
          !showVoiceView) && (
          <motion.div
            variants={buttonAnimations}
            initial="hidden"
            animate="visible"
            exit="hidden"
            style={{
              display: "flex",
              flexDirection: isColumn ? "column" : "row-reverse",
              alignItems: "center",
              gap: isColumn ? "4px" : "8px",
              ...(isColumn ? {
                background: "var(--gray-a3)",
                borderRadius: "9999px",
                padding: "2px",
              } : {}),
            }}
          >
            <motion.div variants={buttonAnimations}>
              <IconButton tone="neutral" size="xsmall"
                style={isServerMuted ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
                onClick={() => {
                  if (isServerMuted) {
                    toast("You are server muted by an admin.", { icon: "🔇", id: "server-muted" });
                    return;
                  }
                  setIsMuted(!isMuted);
                }}
              >
                {(isMuted || isServerMuted) ? <PiMicrophoneSlashFill size={iconSize} /> : <PiMicrophoneFill size={iconSize} />}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton tone="neutral" size="xsmall"
                style={isServerDeafened ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
                onClick={() => {
                  if (isServerDeafened) {
                    toast("You are server deafened by an admin.", { icon: "🔇", id: "server-deafened" });
                    return;
                  }
                  setIsDeafened(!isDeafened);
                }}
              >
                {(isDeafened || isServerDeafened) ? (
                  <PiSpeakerSlashFill size={iconSize} />
                ) : (
                  <PiSpeakerHighFill size={iconSize} />
                )}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton tone="neutral" size="xsmall"
                onClick={handleCameraClick}
              >
                {cameraEnabled ? <PiVideoCameraFill size={iconSize} /> : <PiVideoCameraSlashFill size={iconSize} />}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton tone="neutral" size="xsmall"
                onClick={handleScreenShareClick}
              >
                {screenShareActive ? <PiMonitorArrowUpFill size={iconSize} /> : <PiScreencastFill size={iconSize} />}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton tone="danger" size="xsmall"
                onClick={() => {
                  if (cameraEnabled) setCameraEnabled(false);
                  if (screenShareActive) stopScreenShare();
                  void disconnect();
                }}
              >
                <PiPhoneDisconnectFill size={iconSize} />
              </IconButton>
            </motion.div>
          </motion.div>
        )}
    </AnimatePresence>

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
