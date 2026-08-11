/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states: default · hover · focus · active · disabled · loading · error · success
 *   — carried by @gryt/ui Button and IconButton; this file adds no new controls.
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { Button, Dialog, IconButton } from "@gryt/ui";
import Fireworks from "react-canvas-confetti/dist/presets/explosion";
import { PiX } from "react-icons/pi";

import { useSettings } from "@/settings";

/**
 * The first thing anybody sees.
 *
 * It used to say welcome and then, in the same breath, list what does not work
 * in a browser — a warning box above two paragraphs of links, before the person
 * had seen a single channel. That is a lot to read to find out you are allowed
 * in. The limitations are true and worth saying somewhere they can be acted on;
 * a greeting is not that place.
 *
 * So: a line, and a choice. The tour or not.
 */
export function Welcome() {
  const { hasSeenWelcome, completeWelcome } = useSettings();

  return (
    <>
      {!hasSeenWelcome && (
        <Fireworks autorun={{ duration: 500, speed: 10, delay: 250 }} />
      )}

      {/* Guarded on `open` rather than passed straight through. `completeWelcome`
          marks the welcome seen whenever it runs, so wiring it directly to
          `onOpenChange` would dismiss the dialog the instant it opened — a bug
          this file has had before, hidden by a dialog library that only called
          the handler on close. */}
      <Dialog.Root
        open={!hasSeenWelcome}
        onOpenChange={(open) => {
          // Closing by the X, Esc or the backdrop is a skip. Starting something
          // because somebody dismissed a thing is the wrong way round.
          if (!open) completeWelcome();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[26rem] max-w-[calc(100vw-2rem)] gap-0">
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
              Open-source voice chat. Three things are worth setting up first —
              it takes about a minute.
            </Dialog.Description>

            {/* Stacked under 24rem so neither label can wrap to two lines, which
                is the one thing a button must never do. Primary first in the
                DOM, so it is also first for a keyboard and a screen reader. */}
            <div className="mt-6 flex flex-col gap-2 min-[24rem]:flex-row">
              <Button onClick={() => completeWelcome({ startTour: true })}>
                Show me around
              </Button>
              <Button tone="neutral" onClick={() => completeWelcome()}>
                Skip
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
