import { Box, Button, Heading, HoverCard, IconButton } from "@radix-ui/themes";
import { AnimatePresence, motion, Variants } from "motion/react";
import { BsVolumeOffFill, BsVolumeUpFill } from "react-icons/bs";
import { ImPhoneHangUp } from "react-icons/im";
import { MdArrowForward, MdMic, MdMicOff } from "react-icons/md";

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
                  <BsVolumeOffFill size={12} />
                ) : (
                  <BsVolumeUpFill size={12} />
                )}
              </IconButton>
            </motion.div>

            <motion.div variants={buttonAnimations}>
              <IconButton
                size="1"
                variant="soft"
                color="red"
                onClick={() => {
                  void disconnect();
                }}
              >
                <ImPhoneHangUp size={12} />
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
