import { AlertDialog, Button, TextField } from "@gryt/ui";
import { type ReactNode, useEffect, useState } from "react";

import { phraseMatches } from "../lib/confirmPhrase";

/**
 * Every confirmation in the app, optionally one somebody types their way
 * through.
 *
 * There were six hand-rolled ones, and they disagreed with each other in ways
 * nobody chose: whether the confirm button carried a danger tone, whether Esc
 * was a cancel, and -- on the two that asked for a typed phrase -- whether case
 * mattered and whether a wrong answer disabled the button or raised a toast
 * after the click.
 *
 * `confirmPhrase` is compared case-insensitively and trimmed. The phrase worth
 * asking for is a name somebody is reading off the screen in front of them, and
 * being told to match its capitals is a puzzle rather than a check.
 *
 * Sixteen plain confirms elsewhere are still hand-rolled. They do not
 * disagree with anything, so moving them is tidying rather than a fix, and
 * it is GRYT-1002.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmTone = "danger",
  confirmPhrase,
  confirmPhraseLabel,
  confirmDisabled = false,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  confirmTone?: "danger" | "primary";
  /** When set, the button stays disabled until this is typed back. */
  confirmPhrase?: string;
  confirmPhraseLabel?: ReactNode;
  /** For a caller with a reason of its own -- a request already in flight. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  /** Extra fields -- a reason, a duration, a checkbox. */
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState("");

  // Cleared on open rather than on close, so a phrase typed for one person
  // cannot still be sitting there for the next. That is the same reason the
  // moderation dialogs clear their reason field on open.
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const matches = phraseMatches(typed, confirmPhrase);

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup className="w-[26rem] max-w-[calc(100vw-2rem)]">
          <AlertDialog.Title>{title}</AlertDialog.Title>
          {description && (
            <AlertDialog.Description className="mt-2">{description}</AlertDialog.Description>
          )}

          {children && <div className="flex flex-col gap-3 mt-4">{children}</div>}

          {confirmPhrase && (
            <div className="mt-4">
              <TextField
                label={confirmPhraseLabel ?? `Type ${confirmPhrase} to confirm`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close render={<Button size="small" tone="neutral">Cancel</Button>} />
            {/* Deliberately not wrapped in AlertDialog.Close: it has to be able
                to stay disabled, and Close renders its own button. */}
            <Button
              size="small"
              tone={confirmTone}
              disabled={confirmDisabled || !matches}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
