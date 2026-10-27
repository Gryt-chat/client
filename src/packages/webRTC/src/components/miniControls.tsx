import { IconButton } from "@gryt/ui";
import { useCamera, useScreenShare, useSFU } from "@gryt/voice";
import { AnimatePresence, motion, type Variants } from "motion/react";
import toast from "react-hot-toast";

import { useTheme } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";
import { useServerPermissions } from "@/socket/src/hooks/usePermissions";

import { PiCameraFill, PiCameraSlashFill, PiMicrophoneFill, PiMicrophoneSlashFill, PiMonitorArrowUpFill, PiPhoneDisconnectFill, PiSignOutFill, PiSpeakerHighFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { useInACall } from "../adapters/inACall";
import { useVoicePresence } from "../adapters/useVoicePresence";
import { type CallButton, pressCallButton, useBackToCall } from "./callButtonPress";
import { CallCapsuleFace } from "./CallCapsuleFace";
import { CallControlButton, LEAVE_CLASS } from "./CallControlButton";
import { controlState } from "./controlState";

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
  /** "popout" is the pop-out window's hover bar: a left-to-right row on the capsule, without the call's face. */
  direction: "row" | "column" | "popout";
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

  const { cameraEnabled, setCameraEnabled } = useCamera();
  const { screenShareActive, stopScreenShare, extraWindows } = useScreenShare();
  const backToCall = useBackToCall();
  const openAndPress = (button: CallButton) => {
    backToCall(voice.host, voice.channelId);
    pressCallButton(button);
  };
  const { canIn } = useServerPermissions(currentServerConnected || "");
  // The room's answer. One already on keeps its button, so it can be turned off.
  const showCamera = cameraEnabled || canIn(currentChannelConnected, "share_video");
  const showScreenShare = screenShareActive || canIn(currentChannelConnected, "share_screen");

  const { resolvedAppearance } = useTheme();
  const isColumn = direction === "column";
  const capsule = direction !== "row";
  const iconSize = direction === "row" ? 12 : 16;

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
            className={capsule ? "gryt-call-capsule" : undefined}
            data-live={capsule ? String(voice.live) : undefined}
            data-appearance={capsule ? resolvedAppearance : undefined}
            style={{
              display: "flex",
              flexDirection: ({ column: "column", row: "row-reverse", popout: "row" } as const)[direction],
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
                state={controlState(isServerMuted, isMuted)}
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
                state={controlState(isServerDeafened, isDeafened)}
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

            {/* Plain toggles: off opens the voice view and presses its own button there, on turns straight off. */}
            {showCamera && (
              <motion.div variants={buttonAnimations}>
                <CallControlButton
                  state={cameraEnabled ? "live" : "idle"}
                  aria-label={cameraEnabled ? "Turn camera off" : "Turn camera on"}
                  data-media
                  onClick={() => (cameraEnabled ? setCameraEnabled(false) : openAndPress("camera"))}
                >
                  {cameraEnabled ? <PiCameraFill size={iconSize} /> : <PiCameraSlashFill size={iconSize} />}
                </CallControlButton>
              </motion.div>
            )}

            {showScreenShare && (
              <motion.div variants={buttonAnimations}>
                <CallControlButton
                  state={screenShareActive ? "live" : "idle"}
                  aria-label={screenShareActive ? "Stop sharing" : "Share your screen"}
                  data-media
                  onClick={() => (screenShareActive ? stopScreenShare() : openAndPress("share"))}
                >
                  <PiMonitorArrowUpFill size={iconSize} />
                  {screenShareActive && extraWindows.length > 0 && (
                    <span
                      className="absolute -right-1 -top-1 flex h-[16px] w-[16px] items-center justify-center rounded-full bg-gryt-success-9 text-[10px] font-extrabold text-gryt-success-1"
                      aria-hidden
                    >
                      {extraWindows.length + 1}
                    </span>
                  )}
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
