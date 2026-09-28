import { Button } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { clearLocalArchive, openLocalArchive, useLocalArchive } from "@/common";

import { isElectron } from "../../../../lib/electron";
import { PiWarningFill } from "../../../../lib/icons";
import {
  CLEAR_CONFIRM_TEXT,
  CLEAR_CONFIRM_TITLE,
  CLEAR_LOCAL_HISTORY,
  localHistoryProblemText,
} from "../mls/localHistoryCopy";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Shown while the archive won't open: in a DM above the composer, and in Settings.
 * Try again never deletes anything; only the confirmed clear does.
 */
export function LocalHistoryProblem({ compact = false }: { compact?: boolean }) {
  const { status } = useLocalArchive();
  const [busy, setBusy] = useState<"retry" | "clear" | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (status.kind !== "failed") return null;
  const where = isElectron() ? "on this device" : "in this browser";
  const canRetry = status.code === "unseal-failed" || status.code === null;

  const retry = () => {
    setBusy("retry");
    openLocalArchive()
      .then(() => toast.success("Local history opened."))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  const clear = () => {
    setBusy("clear");
    clearLocalArchive()
      .then(() => toast.success("Local history cleared."))
      .catch((e: unknown) => {
        console.warn("[Archive] Clearing failed:", e);
        toast.error("Couldn't clear local history.");
      })
      .finally(() => setBusy(null));
  };

  return (
    <div
      role="alert"
      className={compact ? "mb-1.5 flex flex-col gap-1.5 px-1 text-xs leading-snug" : "flex flex-col gap-2 text-sm"}
      style={{ color: "var(--gryt-neutral-11)" }}
    >
      <div className="flex items-start gap-1.5">
        <PiWarningFill aria-hidden="true" size={compact ? 13 : 15} style={{ flexShrink: 0, marginTop: "1px", color: "var(--gryt-warning-11)" }} />
        <span>
          {[localHistoryProblemText(status.code, where), compact && "Until then, you can't send messages here.", "Nothing has been deleted."]
            .filter(Boolean)
            .join(" ")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button size="xsmall" tone="neutral" disabled={busy !== null} onClick={retry}>
            {busy === "retry" ? "Trying…" : "Try again"}
          </Button>
        )}
        <Button size="xsmall" tone="danger" disabled={busy !== null} onClick={() => setConfirming(true)}>
          {busy === "clear" ? "Clearing…" : CLEAR_LOCAL_HISTORY}
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={CLEAR_CONFIRM_TITLE}
        description={CLEAR_CONFIRM_TEXT}
        confirmLabel="Clear local history"
        focusCancel
        onConfirm={clear}
      />
    </div>
  );
}
