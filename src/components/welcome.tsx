/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states: default · hover · focus · active · disabled · loading · error · success
 *   — carried by @gryt/ui Button, IconButton and Avatar; this file adds no new controls.
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 */
import { Avatar, Button, Dialog, IconButton, MessageBubble } from "@gryt/ui";
import { PiSignpost, PiX } from "react-icons/pi";

import { useSettings } from "@/settings";

/**
 * The first thing anybody sees.
 *
 * It used to be a dialog written in the first person, which is a different
 * thing from a message from a person. So it is a message now: an avatar, a
 * name, a role, and a bubble — the same parts the rest of the app uses to say
 * somebody said something. A first-run person learns the app's main idiom by
 * being greeted in it.
 *
 * The words are the point. Gryt is mostly one person's work and some of it is
 * rough, and hearing that from him beats finding it out on your own. Anything
 * that undercuts that has to go, which is why the confetti did: fireworks over
 * an apology reads as two different products talking.
 */
export function Welcome() {
  const { hasSeenWelcome, completeWelcome } = useSettings();

  return (
    /* Guarded on `open` rather than passed straight through. `completeWelcome`
       marks the welcome seen whenever it runs, so wiring it directly to
       `onOpenChange` would dismiss the dialog the instant it opened — a bug
       this file has had before, hidden by a dialog library that only called
       the handler on close. */
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
        <Dialog.Popup className="w-[27rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Close
            className="absolute top-3 right-3"
            render={<IconButton size="small" aria-label="Close" />}
          >
            <PiX size={16} />
          </Dialog.Close>

          {/* Padded clear of the close button so a long name can never run
              under it. */}
          <div className="flex items-center gap-2.5 pr-10">
            <Avatar src="/logo.svg" alt="" fallback="G" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold">Sivert</span>
              <span className="text-xs text-gryt-muted">Maintains Gryt</span>
            </span>
          </div>

          {/* The heading is the sender, which tells you who is talking but not
              what this is. Screen readers get the missing half. */}
          <Dialog.Title className="sr-only">Welcome to Gryt</Dialog.Title>

          {/* Two overrides, both forced by the surroundings rather than taste:
              the bubble's own max-width assumes a wide conversation pane, and
              its assistant fill is the same token as the dialog it is sitting
              on, so without the step up it would be a border and nothing else. */}
          <MessageBubble className="max-w-full bg-gryt-surface-raised">
            {/* Description defaults to muted, which is right for a subtitle
                under a title and wrong here — this is the whole message. */}
            <Dialog.Description className="text-gryt-text" render={<div />}>
              <p>Hey there! 👋 Welcome to Gryt!</p>
              <p className="mt-2.5">
                I&rsquo;m really glad you&rsquo;re here, and that you decided to
                give it a go. It&rsquo;s all built by me, a senior developer
                from Norway 🇳🇴
              </p>
              <p className="mt-2.5">
                That does mean some things are still a bit rough around the
                edges. If something breaks, please tell me. There&rsquo;s a Give
                feedback button in settings.
              </p>
              <p className="mt-2.5">
                If you&rsquo;re ready, I&rsquo;d be happy to show you around.
                Enjoy Gryt! 😊
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
              Show me around
            </Button>
            <Button tone="ghost" onClick={() => completeWelcome()}>
              I&rsquo;ll look myself
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
