import { Checkbox, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Reporting a person, as opposed to one thing they said: nothing is attached, so
 * the reason is required. **Blocking is offered here, and defaults to on.**
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

  /* Cleared when it opens rather than when it closes, so a reason half typed is
     still there if the dialog is dismissed by accident. */
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
    <ConfirmDialog
      open={!!target}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={`Report ${target?.nickname}?`}
      description={
        <>
          This goes to the moderators of this server, who can see that it came
          from you. {target?.nickname} is told nothing.
        </>
      }
      confirmLabel="Report"
      confirmTone="primary"
      confirmDisabled={!canSubmit}
      onConfirm={() => {
        if (!target || !canSubmit) return;
        onSubmit({
          serverUserId: target.serverUserId,
          reason: trimmed,
          alsoBlock: alsoBlock && !alreadyBlocked,
        });
        onClose();
      }}
    >
      <div className="flex flex-col gap-1">
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
        <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Checkbox
            checked={alsoBlock}
            onCheckedChange={(v) => setAlsoBlock(v === true)}
          />
          Block them as well, so they cannot reach you while this is looked at
        </label>
      )}
    </ConfirmDialog>
  );
}
