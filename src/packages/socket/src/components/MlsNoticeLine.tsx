import { Button } from "@gryt/ui";
import { useState } from "react";

import { PiInfoFill } from "../../../../lib/icons";
import type { MlsAction } from "../mls/useMlsConversation";
import { ConfirmDialog } from "./ConfirmDialog";

/** The line above the composer for a DM on MLS, with whatever it offers to do about it. */
export function MlsNoticeLine({ notice, actions }: { notice: string; actions: MlsAction[] }) {
  const [confirming, setConfirming] = useState<MlsAction | null>(null);

  return (
    <div
      aria-live="polite"
      className="mb-1.5 flex items-start gap-1.5 px-1 text-xs leading-snug"
      style={{ color: "var(--gryt-neutral-11)" }}
    >
      <PiInfoFill aria-hidden="true" size={13} style={{ flexShrink: 0, marginTop: "1px" }} />
      <div className="flex min-w-0 flex-col gap-2">
        <span>{notice}</span>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((action, i) => (
              <Button
                key={action.label}
                size="small"
                tone={i === 0 ? "primary" : "neutral"}
                onClick={() => (action.confirm ? setConfirming(action) : action.run())}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {confirming?.confirm && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          title={confirming.confirm.title}
          description={confirming.confirm.description}
          confirmLabel={confirming.confirm.confirmLabel}
          confirmTone="danger"
          onConfirm={() => {
            confirming.run();
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
