import { Alert, Button, Dialog, IconButton } from "@gryt/ui";
import Fireworks from "react-canvas-confetti/dist/presets/explosion";
import { PiWarningFill, PiX } from "react-icons/pi";

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
          <Dialog.Popup className="w-[30rem] max-w-[calc(100vw-3rem)] gap-0">
            <Dialog.Close
              className="absolute top-3 right-3"
              render={<IconButton size="small" aria-label="Close" />}
            >
              <PiX size={16} />
            </Dialog.Close>

            <Dialog.Title className="pr-10 text-2xl font-semibold tracking-tight">
              Welcome to Gryt
            </Dialog.Title>

            <Dialog.Description className="mt-2 text-sm leading-6 text-gryt-muted">
              An open-source voice chat app. Closing this starts a short tour of
              the three things worth setting up — it takes about a minute.
            </Dialog.Description>

            {/* One action, not two competing downloads.
                The previous version put "Download Desktop App" and "Self-Host a
                Server" side by side as equal primaries and offered no way into
                the app at all, so the only obvious move was to close it. The
                two links survive below, weighted as what they are: things you
                might do later, not the first thing to do now. */}
            <div className="mt-5">
              <Button onClick={updateHasSeenWelcome}>Get started</Button>
            </div>

            {inBrowser ? (
              <>
                <Alert
                  severity="warning"
                  className="mt-5 flex items-start gap-2 text-xs leading-5"
                >
                  <PiWarningFill size={14} className="mt-0.5 shrink-0" />
                  <span>
                    In the browser, global push-to-talk, auto-updates and tray
                    integration are unavailable. Everything else works.
                  </span>
                </Alert>

                <p className="mt-4 mb-0 text-xs leading-5 text-gryt-muted">
                  <a
                    className="text-gryt-text underline decoration-gryt-border underline-offset-2 transition-colors hover:decoration-gryt-accent"
                    href="https://github.com/Gryt-chat/gryt/releases"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download the desktop app
                  </a>{" "}
                  for the full experience, or{" "}
                  <a
                    className="text-gryt-text underline decoration-gryt-border underline-offset-2 transition-colors hover:decoration-gryt-accent"
                    href="https://docs.gryt.chat/docs/guide/quick-start"
                    target="_blank"
                    rel="noreferrer"
                  >
                    host your own server
                  </a>
                  .
                </p>
              </>
            ) : null}

            <p className="mt-4 mb-0 text-xs leading-5 text-gryt-muted">
              Questions go to the{" "}
              <a
                className="text-gryt-text underline decoration-gryt-border underline-offset-2 transition-colors hover:decoration-gryt-accent"
                href="https://forum.gryt.chat/"
                target="_blank"
                rel="noreferrer"
              >
                forum
              </a>{" "}
              or the{" "}
              <a
                className="text-gryt-text underline decoration-gryt-border underline-offset-2 transition-colors hover:decoration-gryt-accent"
                href="https://app.gryt.chat/invite?host=app.gryt.chat&code=gc9vHTFCOW"
              >
                official server
              </a>
              .
            </p>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
