import { Dialog, IconButton } from "@gryt/ui";
import { Flex } from "@radix-ui/themes";
import Fireworks from "react-canvas-confetti/dist/presets/explosion";
import { PiX } from "react-icons/pi";

import { useSettings } from "@/settings";

export function ShareServer() {
  const { hasSeenWelcome, completeWelcome } = useSettings();

  return (
    <>
      {!hasSeenWelcome && (
        <Fireworks autorun={{ duration: 500, speed: 10, delay: 250 }} />
      )}
      <Dialog.Root open={!hasSeenWelcome} onOpenChange={(open) => { if (!open) completeWelcome(); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="max-w-150">
          <Dialog.Close
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
            }}
          >
            <IconButton tone="neutral" size="xsmall">
              <PiX size={16} />
            </IconButton>
          </Dialog.Close>
          <Flex direction="column" gap="2">
            <Dialog.Title>
              Welcome to Gryt!🎉
            </Dialog.Title>

            <Dialog.Description>
              Gryt is a voice chat app that allows you to connect with your
              friends and family. You can create your own server, invite your
              friends, and start talking!
            </Dialog.Description>

            <Dialog.Description>
              To get started, use the menu on the left to add a server. Once you
              do that, you can invite your friends to join you.
            </Dialog.Description>

            <Dialog.Description>
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
        </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
