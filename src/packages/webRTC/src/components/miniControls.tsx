import { IconButton } from "@gryt/ui";
import { useCamera, useScreenShare, useSFU } from "@gryt/voice";
import { AnimatePresence, motion, Variants } from "motion/react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";
import { useServerPermissions } from "@/socket/src/hooks/usePermissions";

import { PiMicrophoneFill, PiMicrophoneSlashFill, PiPhoneDisconnectFill, PiSpeakerHighFill, PiSpeakerSimpleHighFill, PiSpeakerSimpleSlashFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { useScreenAudioMute } from "../adapters/useScreenAudioMute";
import { useVoicePresence } from "../adapters/useVoicePresence";
import { CallControlButton, LEAVE_CLASS } from "./CallControlButton";
import { CameraControl } from "./CameraControl";
import { ScreenShareControl } from "./ScreenShareControl";

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

  const { disconnect, currentServerConnected, currentChannelConnected } = useSFU();
  const voice = useVoicePresence();

  const { muted: screenAudioMuted, available: canMuteScreenAudio, setMuted: setScreenAudioMuted } = useScreenAudioMute();
  const { cameraEnabled } = useCamera();
  const { screenShareActive } = useScreenShare();
  const { canIn } = useServerPermissions(currentServerConnected || "");
  // The room's answer. One already on keeps its button, so it can be turned off.
  const showCamera = cameraEnabled || canIn(currentChannelConnected, "share_video");
  const showScreenShare = screenShareActive || canIn(currentChannelConnected, "share_screen");

  const isColumn = direction === "column";
  const iconSize = isColumn ? 14 : 12;

  return (
    <>
    <AnimatePresence>
      {/* Shown for a call that is coming up or coming back too, not only one
          that is up. Hang up is here, and that is when you want it most. */}
      {voice.inCall &&
        (currentlyViewingServer?.host !== voice.host || !showVoiceView) && (
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
                // Tinted while the call is not up yet, so the controls being
                // there is not read as the call being there.
                background: voice.live
                  ? "var(--gryt-neutral-a3)"
                  : "var(--gryt-warning-a3)",
                borderRadius: "9999px",
                padding: "2px",
              } : {}),
            }}
          >
            <motion.div variants={buttonAnimations}>
              <CallControlButton
                state={isServerMuted ? "blocked" : isMuted ? "off" : "idle"}
                aria-label={(isMuted || isServerMuted) ? "Unmute microphone" : "Mute microphone"}
                onClick={() => {
                  if (isServerMuted) {
                    toast("You are server muted by an admin.", { icon: <PiMicrophoneSlashFill size={18} />, id: "server-muted" });
                    return;
                  }
                  setIsMuted(!isMuted);
                }}
              >
                {(isMuted || isServerMuted) ? <PiMicrophoneSlashFill size={iconSize} /> : <PiMicrophoneFill size={iconSize} />}
              </CallControlButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <CallControlButton
                state={isServerDeafened ? "blocked" : isDeafened ? "off" : "idle"}
                aria-label={(isDeafened || isServerDeafened) ? "Undeafen" : "Deafen"}
                onClick={() => {
                  if (isServerDeafened) {
                    toast("You are server deafened by an admin.", { icon: <PiSpeakerSlashFill size={18} />, id: "server-deafened" });
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
              </CallControlButton>
            </motion.div>

            {showCamera && (
              <motion.div variants={buttonAnimations}>
                <CameraControl iconSize={iconSize} side={isColumn ? "right" : "top"} />
              </motion.div>
            )}

            {showScreenShare && (
              <motion.div variants={buttonAnimations}>
                <ScreenShareControl iconSize={iconSize} side={isColumn ? "right" : "top"} />
              </motion.div>
            )}

            {canMuteScreenAudio && (
              <motion.div variants={buttonAnimations}>
                <CallControlButton
                  state={screenAudioMuted ? "off" : "idle"}
                  aria-label={screenAudioMuted ? "Unmute the audio you're sharing" : "Mute the audio you're sharing"}
                  onClick={() => setScreenAudioMuted(!screenAudioMuted)}
                >
                  {screenAudioMuted ? <PiSpeakerSimpleSlashFill size={iconSize} /> : <PiSpeakerSimpleHighFill size={iconSize} />}
                </CallControlButton>
              </motion.div>
            )}

            <motion.div variants={buttonAnimations}>
              <IconButton tone="danger" size="xsmall" className={LEAVE_CLASS}
                aria-label="Leave voice channel"
                onClick={() => {
                  // Local capture is stopped inside disconnect(). GRYT-305.
                  void disconnect();
                }}
              >
                <PiPhoneDisconnectFill size={iconSize} />
              </IconButton>
            </motion.div>
          </motion.div>
        )}
    </AnimatePresence>

    </>
  );
}
