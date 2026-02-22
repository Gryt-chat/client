import { TriangleAlert as ExclamationTriangleIcon } from "lucide-react";
import { Button, Callout, Dialog, Flex, IconButton, Text } from "@radix-ui/themes";
import Fireworks from "react-canvas-confetti/dist/presets/explosion";
import { Download as FiDownload, Server as FiServer, X as FiX } from "lucide-react";

import { useSettings } from "@/settings";

import { isElectron } from "../lib/electron";

export function Welcome() {
  const { hasSeenWelcome, updateHasSeenWelcome } = useSettings();
  const inBrowser = !isElectron();

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

            {inBrowser ? (
              <>
                <Dialog.Description size="2" mb="2">
                  Gryt is an open-source voice chat app. You're trying it out
                  right in your browser — go ahead, add a server and start
                  talking!
                </Dialog.Description>

                <Callout.Root color="orange" size="1" mb="2">
                  <Callout.Icon>
                    <ExclamationTriangleIcon />
                  </Callout.Icon>
                  <Callout.Text>
                    Some features are limited in the browser: global push-to-talk
                    (when the window is unfocused), auto-updates, and system
                    tray integration are only available in the desktop app.
                  </Callout.Text>
                </Callout.Root>

                <Text size="2" mb="3" color="gray">
                  You can spin up your own server and connect to it from this web
                  app, or download the desktop client for the full experience.
                </Text>

                <Flex gap="2" wrap="wrap">
                  <Button asChild variant="solid" size="2">
                    <a
                      href="https://github.com/Gryt-chat/gryt/releases"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FiDownload size={14} />
                      Download Desktop App
                    </a>
                  </Button>
                  <Button asChild variant="soft" size="2">
                    <a
                      href="https://docs.gryt.chat/docs/guide/quick-start"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <FiServer size={14} />
                      Self-Host a Server
                    </a>
                  </Button>
                </Flex>
              </>
            ) : (
              <>
                <Dialog.Description size="2" mb="4">
                  Gryt is a voice chat app that allows you to connect with your
                  friends and family. You can create your own server, invite your
                  friends, and start talking!
                </Dialog.Description>

                <Dialog.Description size="2" mb="4">
                  To get started, use the menu on the left to add a server. Once
                  you do that, you can invite your friends to join you.
                </Dialog.Description>
              </>
            )}

            <Dialog.Description size="2" mb="4" mt={inBrowser ? "2" : undefined}>
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
