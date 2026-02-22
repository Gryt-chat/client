import { Dialog, Flex, IconButton } from "@radix-ui/themes";
import Fireworks from "react-canvas-confetti/dist/presets/explosion";
import { FiX } from "react-icons/fi";

import { useSettings } from "@/settings";

export function Welcome() {
  const { hasSeenWelcome, updateHasSeenWelcome } = useSettings();

  return (
    <>
      {!hasSeenWelcome && (
        <Fireworks autorun={{ duration: 500, speed: 10, delay: 250 }} />
      )}
      <Dialog.Root open={!hasSeenWelcome} onOpenChange={updateHasSeenWelcome}>
        <Dialog.Content maxWidth="600px">
          <Dialog.Close
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
            }}
          >
            <IconButton variant="soft" color="gray">
              <FiX size={16} />
            </IconButton>
          </Dialog.Close>
          <Flex direction="column" gap="2">
            <Dialog.Title as="h1" weight="bold" size="6">
              Welcome to Gryt!🎉
            </Dialog.Title>

            <Dialog.Description size="2" mb="4">
              Gryt is a voice chat app that allows you to connect with your
              friends and family. You can create your own server, invite your
              friends, and start talking!
            </Dialog.Description>

            <Dialog.Description size="2" mb="4">
              To get started, use the menu on the left to add a server. Once you
              do that, you can invite your friends to join you.
            </Dialog.Description>

            <Dialog.Description size="2" mb="4">
              If you have any questions, feel free to ask in the{" "}
              <a href="https://forum.gryt.chat/" target="_blank">
                Gryt Forum
              </a>{" "}
              or the{" "}
              <a href="https://app.gryt.chat/invite?host=app.gryt.chat&code=gc9vHTFCOW">
                Official Gryt server
              </a>
              .
            </Dialog.Description>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
