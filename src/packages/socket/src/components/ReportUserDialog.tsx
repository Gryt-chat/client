import { AlertDialog, Button, Checkbox, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

/**
 * Reporting a person, as opposed to reporting one thing they said.
 *
 * A message report needs no explanation — the message is attached and the
 * moderator reads it. This one has nothing attached, so the reason is required
 * and the button stays off until there is one. A card in the queue saying only
 * that somebody is unhappy cannot be acted on.
 *
 * **Blocking is offered here, and defaults to on.** The report goes to whoever
 * is awake to read it, which at three in the morning is nobody; the block takes
 * effect on the way out. It is per server and reversible from the same menu, so
 * defaulting it on costs a click to undo and defaulting it off costs the night.
 */
export const REPORT_REASON_MAX = 1000;

export function ReportUserDialog({
  target,
  onClose,
  onSubmit,
  isBlocked,
}: {
  /** Who is being reported, or null when the dialog is closed. */
  target: { serverUserId: string; nickname: string } | null;
  onClose: () => void;
  onSubmit: (args: { serverUserId: string; reason: string; alsoBlock: boolean }) => void;
  /** Already blocked, in which case the offer is left out rather than shown ticked. */
  isBlocked: (serverUserId: string) => boolean;
}) {
  const [reason, setReason] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);

  /* Cleared when it opens rather than when it closes, so a reason half typed
     is still there if the dialog is dismissed by accident and reopened — the
     same way the kick and ban dialogs handle theirs. */
  useEffect(() => {
    if (target) {
      setReason("");
      setAlsoBlock(!isBlocked(target.serverUserId));
    }
  }, [target, isBlocked]);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= REPORT_REASON_MAX;
  const alreadyBlocked = target ? isBlocked(target.serverUserId) : false;

  return (
    <AlertDialog.Root
      open={!!target}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup>
          <AlertDialog.Title>Report {target?.nickname}?</AlertDialog.Title>
          <AlertDialog.Description>
            This goes to the moderators of this server, who can see that it came
            from you. {target?.nickname} is told nothing.
          </AlertDialog.Description>

          <div className="flex flex-col gap-1 mt-3">
            <span className="text-xs">What happened?</span>
            <TextField
              multiline
              minRows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Following me between channels and repeating it after I asked them to stop"
              maxLength={REPORT_REASON_MAX}
            />
            <span className="text-xs text-gryt-muted">
              {trimmed.length}/{REPORT_REASON_MAX}
            </span>
          </div>

          {!alreadyBlocked && (
            <label className="text-sm mt-3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Checkbox
                checked={alsoBlock}
                onCheckedChange={(v) => setAlsoBlock(v === true)}
              />
              Block them as well, so they cannot reach you while this is looked at
            </label>
          )}

          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close render={<Button size="small">Cancel</Button>} />
            <Button
              size="small"
              disabled={!canSubmit}
              onClick={() => {
                if (!target || !canSubmit) return;
                onSubmit({
                  serverUserId: target.serverUserId,
                  reason: trimmed,
                  alsoBlock: alsoBlock && !alreadyBlocked,
                });
                onClose();
              }}
            >
              Report
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
