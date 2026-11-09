/* Hallmark · component: panel · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states carried by @gryt/ui Button and Spinner; the QR is linkDevice's. */
import { Button, Spinner } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";

import { useLinkDevice } from "../lib/pairing/useLinkDevice";
import { QrCode } from "./linkDevice";

/**
 * Sign in by scanning with your phone: the link's QR, shown in place. Your phone brings the
 * account, servers and messages. Once it's scanned, the rest carries on in the link dialog.
 */
export function ScanToSignIn({ onScanned }: { onScanned?: () => void }) {
  const { state, open, startInline, stopInline, reveal } = useLinkDevice();
  const [needsWarning, setNeedsWarning] = useState(false);
  const scanned = useRef(onScanned);
  scanned.current = onScanned;

  useEffect(() => {
    setNeedsWarning(!startInline());
    return stopInline;
  }, [startInline, stopInline]);

  const phase = state?.phase;
  useEffect(() => {
    if (!phase || phase === "idle" || phase === "opening" || phase === "showing") return;
    reveal();
    scanned.current?.();
  }, [phase, reveal]);

  if (needsWarning) {
    return (
      <Button size="small" tone="neutral" style={{ alignSelf: "flex-start" }} onClick={open}>
        Sign in with your phone
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {state?.phase === "showing" ? (
        <QrCode text={`gryt://link?p=${encodeURIComponent(state.qr)}`} label="Code to scan with your phone" className="h-32 w-32 shrink-0" />
      ) : (
        <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-[var(--gryt-radius-md)] bg-gryt-surface-raised" role="status" aria-label="Getting a code">
          <Spinner />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">Sign in with your phone</span>
        <span className="text-xs text-gryt-muted">
          Point your phone&rsquo;s camera at the code. Gryt opens there, and your account, servers and
          messages come over to this computer.
        </span>
        {state?.phase === "showing" && (
          <span className="text-xs text-gryt-muted">
            No camera? Type <code className="font-mono text-gryt-text select-all">{state.code}</code> in Link a device.
          </span>
        )}
      </div>
    </div>
  );
}
