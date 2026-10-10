/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states carried by @gryt/ui Button, IconButton and Avatar; no new controls here. */
import { Avatar, Button, Dialog, IconButton, MessageBubble } from "@gryt/ui";

import { useAccount } from "@/common";
import { useTranslation } from "@/i18n";
import { useSettings } from "@/settings";

import { PiSignpost, PiX } from "../lib/icons";
import { useLinkDevice } from "../lib/pairing/useLinkDevice";

/**
 * The first thing anybody sees, drawn as a message rather than a dialog, so a
 * first-run person learns the app's main idiom by being greeted in it.
 */
export function Welcome() {
  const { t: tr } = useTranslation();
  const { hasSeenWelcome, settingsLoaded, completeWelcome } = useSettings();
  const { isSignedIn } = useAccount();
  const { open: openLinkDevice } = useLinkDevice();

  return (
    /* Guarded on `open` rather than passed straight through: `completeWelcome`
       marks the welcome seen whenever it runs. */

    /* `settingsLoaded` and not a timer. Until the settings are read, "has this
       person seen the welcome" has no answer, and false flashed it at them. */
    <Dialog.Root
      open={settingsLoaded && !hasSeenWelcome}
      onOpenChange={(open) => {
        // Closing by the X, Esc or the backdrop is a skip. Starting something
        // because somebody dismissed a thing is the wrong way round.
        if (!open) completeWelcome();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[27rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Close
            className="absolute top-3 right-3"
            render={<IconButton size="small" aria-label={tr("ui.close")} />}
          >
            <PiX size={16} />
          </Dialog.Close>

          {/* Padded clear of the close button so a long name can never run
              under it. */}
          <div className="flex items-center gap-2.5 pr-10">
            <Avatar src="/logo.svg" alt="" fallback="G" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold">Sivert</span>
              <span className="text-xs text-gryt-muted">{tr("ui.maintainsGryt")}</span>
            </span>
          </div>

          {/* The heading is the sender, which tells you who is talking but not
              what this is. Screen readers get the missing half. */}
          <Dialog.Title className="sr-only">{tr("ui.welcomeToGryt")}</Dialog.Title>

          {/* Two overrides, both forced by the surroundings rather than taste:
              the bubble's own max-width assumes a wide conversation pane, and
              its assistant fill is the same token as the dialog it is sitting
              on, so without the step up it would be a border and nothing else. */}
          <MessageBubble className="max-w-full bg-gryt-surface-raised">
            {/* Description defaults to muted, which is right for a subtitle
                under a title and wrong here — this is the whole message. */}
            <Dialog.Description className="text-gryt-text" render={<div />}>
              <p>{tr("ui.heyThereWelcomeToGryt")}</p>
              <p className="mt-2.5">
                {tr("ui.iMReallyGladYouReHereAnd")}
              </p>
              <p className="mt-2.5">
                {tr("ui.itSJustMeKeepingItRunningSo")}
              </p>
              <p className="mt-2.5">
                {tr("ui.ifYouReReadyIDBeHappy")}
              </p>
            </Dialog.Description>
          </MessageBubble>

          {/* Stacked under 24rem so neither label can wrap to two lines, which
              is the one thing a button must never do. Primary first in the
              DOM, so it is also first for a keyboard and a screen reader. */}
          <div className="flex flex-col gap-2 min-[24rem]:flex-row">
            <Button
              startIcon={<PiSignpost size={18} />}
              onClick={() => completeWelcome({ startTour: true })}
            >
              {tr("ui.showMeAround")}
            </Button>
            <Button tone="ghost" onClick={() => completeWelcome()}>
              {tr("ui.iLlLookMyself")}
            </Button>
          </div>

          {isSignedIn === false && (
            <p className="m-0 text-xs text-gryt-muted">
              {tr("ui.alreadyUseGrytOnAnotherDevice")}{" "}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-gryt-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-gryt-accent-light"
                onClick={() => {
                  completeWelcome();
                  openLinkDevice();
                }}
              >
                {tr("ui.linkWithAnotherDevice")}
              </button>
            </p>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
