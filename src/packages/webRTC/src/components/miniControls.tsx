import { Box, Button, Heading, HoverCard, IconButton } from "@radix-ui/themes";
import { AnimatePresence, motion, Variants } from "motion/react";
import { MdArrowForward, MdCallEnd, MdMic, MdMicOff, MdScreenShare, MdStopScreenShare, MdVideocam, MdVideocamOff, MdVolumeOff, MdVolumeUp } from "react-icons/md";

import { useCamera, useScreenShare } from "@/audio";
import { getServerHttpBase } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement,useSockets } from "@/socket";

import { useSFU } from "../hooks/useSFU";

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
    setShowVoiceView,
    setIsDeafened,
  } = useSettings();
  
  const {
    switchToServer,
    currentlyViewingServer,
  } = useServerManagement();

  const {
    currentServerConnected,
    disconnect,
    currentChannelConnected,
    isConnected,
  } = useSFU();

  const { cameraEnabled, setCameraEnabled } = useCamera();
  const { screenShareActive, startScreenShare, stopScreenShare } = useScreenShare();

  const { getChannelDetails, serverDetailsList } = useSockets();

  return (
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
              flexDirection: direction === "column" ? "column" : "row-reverse",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <motion.div variants={buttonAnimations}>
              <IconButton
                size="1"
                color={isMuted ? "red" : "gray"}
                variant="soft"
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <MdMicOff size={12} /> : <MdMic size={12} />}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton
                size="1"
                color={isDeafened ? "red" : "gray"}
                variant="soft"
                onClick={() => setIsDeafened(!isDeafened)}
              >
                {isDeafened ? (
                  <MdVolumeOff size={12} />
                ) : (
                  <MdVolumeUp size={12} />
                )}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton
                size="1"
                color={cameraEnabled ? "green" : "gray"}
                variant="soft"
                onClick={() => setCameraEnabled(!cameraEnabled)}
              >
                {cameraEnabled ? <MdVideocam size={12} /> : <MdVideocamOff size={12} />}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton
                size="1"
                color={screenShareActive ? "green" : "gray"}
                variant="soft"
                onClick={() => {
                  if (screenShareActive) stopScreenShare();
                  else startScreenShare(true);
                }}
              >
                {screenShareActive ? <MdStopScreenShare size={12} /> : <MdScreenShare size={12} />}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton
                size="1"
                variant="soft"
                color="red"
                onClick={() => {
                  if (cameraEnabled) setCameraEnabled(false);
                  if (screenShareActive) stopScreenShare();
                  void disconnect();
                }}
              >
                <MdCallEnd size={12} />
              </IconButton>
            </motion.div>
            <motion.div variants={buttonAnimations}>
              <HoverCard.Root
                openDelay={100}
                closeDelay={0}
                key={currentServerConnected}
              >
                <HoverCard.Trigger>
                  <Button
                    variant="soft"
                    style={{
                      height: "32px",
                      width: "32px",
                      padding: "0",
                      position: "relative",
                      overflow: "hidden",
                    }}
                    color="gray"
                    onClick={() => {
                      switchToServer(currentServerConnected);
                      setShowVoiceView(true);
                    }}
                  >
                    <img
                      style={{
                        position: "absolute",
                        width: "24px",
                        height: "24px",
                        borderRadius: "100%",
                        opacity: 0.25,
                        objectFit: "cover",
                        objectPosition: "center",
                      }}
                      src={`${getServerHttpBase(currentServerConnected)}/icon${currentServerConnected && serverDetailsList[currentServerConnected]?.server_info?.icon_url ? `?v=${encodeURIComponent(serverDetailsList[currentServerConnected].server_info!.icon_url!)}` : ''}`}
                    />

                    <MdArrowForward size={12} />
                  </Button>
                </HoverCard.Trigger>
                <HoverCard.Content
                  maxWidth="300px"
                  side="right"
                  size="1"
                  align="center"
                >
                  <Box>
                    <Heading size="1">
                      Go to{" "}
                      {
                        getChannelDetails(
                          currentServerConnected,
                          currentChannelConnected
                        )?.name
                      }
                    </Heading>
                  </Box>
                </HoverCard.Content>
              </HoverCard.Root>
            </motion.div>
          </motion.div>
        )}
    </AnimatePresence>
  );
}
