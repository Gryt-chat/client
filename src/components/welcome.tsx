import { Alert, Button, Dialog, IconButton } from "@gryt/ui";
import Fireworks from "react-canvas-confetti/dist/presets/explosion";
import { PiDownloadSimpleFill, PiHardDrivesFill, PiWarningFill, PiX } from "react-icons/pi";

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
      {/* Guarded on `open` rather than passed straight through.
          updateHasSeenWelcome takes no arguments and unconditionally marks the
          welcome as seen, so wiring it directly to onOpenChange means any
          open-state change dismisses it forever — including the one that opens
          it. Radix only ever called this on close, which hid the problem. */}
      <Dialog.Root
        open={!hasSeenWelcome}
        onOpenChange={(open) => {
          if (!open) {
            updateHasSeenWelcome();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[600px] max-w-[calc(100vw-3rem)]">
            <Dialog.Close
              className="absolute top-2 right-2"
              render={<IconButton size="small" aria-label="Close" />}
            >
              <PiX size={16} />
            </Dialog.Close>

            <Dialog.Title className="text-2xl font-bold">
              Welcome to Gryt!🎉
            </Dialog.Title>

            {inBrowser ? (
              <>
                {/* Only one Description per dialog: Base UI wires it to
                    aria-describedby, and several would leave a screen reader
                    announcing whichever one won. The rest are plain paragraphs. */}
                <Dialog.Description>
                  Gryt is an open-source voice chat app. You're trying it out
                  right in your browser — go ahead, add a server and start
                  talking!
                </Dialog.Description>

                <Alert severity="warning" className="flex items-start gap-2">
                  <PiWarningFill size={16} className="mt-0.5 shrink-0" />
                  <span>
                    Some features are limited in the browser: global push-to-talk
                    (when the window is unfocused), auto-updates, and system
                    tray integration are only available in the desktop app.
                  </span>
                </Alert>

                <p className="text-sm text-gryt-muted">
                  You can spin up your own server and connect to it from this web
                  app, or download the desktop client for the full experience.
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="small"
                    className="no-underline"
                    startIcon={<PiDownloadSimpleFill size={14} />}
                    render={
                      <a
                        href="https://github.com/Gryt-chat/gryt/releases"
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    Download Desktop App
                  </Button>
                  <Button
                    size="small"
                    tone="neutral"
                    className="no-underline"
                    startIcon={<PiHardDrivesFill size={14} />}
                    render={
                      <a
                        href="https://docs.gryt.chat/docs/guide/quick-start"
                        target="_blank"
                        rel="noreferrer"
                      />
                    }
                  >
                    Self-Host a Server
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Dialog.Description>
                  Gryt is a voice chat app that allows you to connect with your
                  friends and family. You can create your own server, invite your
                  friends, and start talking!
                </Dialog.Description>

                <p className="text-sm text-gryt-muted">
                  To get started, use the menu on the left to add a server. Once
                  you do that, you can invite your friends to join you.
                </p>
              </>
            )}

            <p className="text-sm text-gryt-muted">
              If you have any questions, feel free to ask in the{" "}
              <a
                className="text-gryt-text underline decoration-gryt-border underline-offset-2 hover:decoration-gryt-accent"
                href="https://forum.gryt.chat/"
                target="_blank"
                rel="noreferrer"
              >
                Gryt Forum
              </a>{" "}
              or the{" "}
              <a
                className="text-gryt-text underline decoration-gryt-border underline-offset-2 hover:decoration-gryt-accent"
                href="https://app.gryt.chat/invite?host=app.gryt.chat&code=gc9vHTFCOW"
              >
                Official Gryt server
              </a>
              .
            </p>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
