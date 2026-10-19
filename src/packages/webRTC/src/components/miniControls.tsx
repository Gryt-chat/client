import { IconButton } from "@gryt/ui";
import { useCamera, useScreenShare, useSFU } from "@gryt/voice";
import { AnimatePresence, motion, type Variants } from "motion/react";
import toast from "react-hot-toast";

import { useTheme } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";
import { useServerPermissions } from "@/socket/src/hooks/usePermissions";

import { PiMicrophoneFill, PiMicrophoneSlashFill, PiPhoneDisconnectFill, PiSignOutFill, PiSpeakerHighFill, PiSpeakerSimpleHighFill, PiSpeakerSimpleSlashFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { useInACall } from "../adapters/inACall";
import { useScreenAudioMute } from "../adapters/useScreenAudioMute";
import { useVoicePresence } from "../adapters/useVoicePresence";
import { CallCapsuleFace } from "./CallCapsuleFace";
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
  const inACall = useInACall();
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

  const { resolvedAppearance } = useTheme();
  const isColumn = direction === "column";
  const iconSize = isColumn ? 16 : 12;

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
            className={isColumn ? "gryt-call-capsule" : undefined}
            data-live={isColumn ? String(voice.live) : undefined}
            data-appearance={isColumn ? resolvedAppearance : undefined}
            style={{
              display: "flex",
              flexDirection: isColumn ? "column" : "row-reverse",
              alignItems: "center",
              gap: isColumn ? "5px" : "8px",
            }}
          >
            {/* The capsule says whose call it is, not only that there is one (board 13). */}
            {isColumn && (
              <motion.div variants={buttonAnimations}>
                <CallCapsuleFace host={voice.host} channelId={voice.channelId} live={voice.live} />
              </motion.div>
            )}
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
                aria-label={inACall ? "Hang up" : "Leave voice channel"}
                onClick={() => {
                  // Local capture is stopped inside disconnect(). GRYT-305.
                  void disconnect();
                }}
              >
                {inACall ? <PiPhoneDisconnectFill size={iconSize} /> : <PiSignOutFill size={iconSize} />}
              </IconButton>
            </motion.div>
          </motion.div>
        )}
    </AnimatePresence>

    </>
  );
}
