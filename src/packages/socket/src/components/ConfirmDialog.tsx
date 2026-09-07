import { AlertDialog, Button, TextField } from "@gryt/ui";
import { type ReactNode, useEffect, useState } from "react";

import { phraseMatches } from "../lib/confirmPhrase";

/**
 * A confirmation, optionally one somebody has to type their way through.
 *
 * There are two hand-rolled versions of the typing part already -- deleting a
 * server types the server's name, resetting a message key types "start again"
 * -- and they disagree about whether case matters and about whether a wrong
 * answer disables the button or raises a toast. This is the third thing that
 * wants it, so it is a component rather than a fourth copy. Migrating the other
 * two is GRYT-996.
 *
 * `confirmPhrase` is compared case-insensitively and trimmed. The phrase worth
 * asking for is usually a name somebody is reading off the row in front of
 * them, and being told to match the capitals of a nickname they did not choose
 * is a puzzle rather than a check.
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
            <AlertDialog.Close render={<Button tone="neutral">Cancel</Button>} />
            {/* Deliberately not wrapped in AlertDialog.Close: it has to be able
                to stay disabled, and Close renders its own button. */}
            <Button
              tone={confirmTone}
              disabled={!matches}
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
