import { Button, Dialog } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { approveHandover, denyHandover, handoverRequests } from "@/socket";

/**
 * Another device of yours asks this one to hand a server over to its key (GRYT-1886). Only
 * this device's key can, so a stolen password alone never gets past here.
 */
export function HandoverRequestDialog() {
  const requests = handoverRequests.use();
  const [busy, setBusy] = useState(false);
  const request = requests[0];

  const approve = async () => {
    if (!request) return;
    setBusy(true);
    const ok = await approveHandover(request).catch(() => false);
    setBusy(false);
    if (ok) toast.success(`${request.deviceName} now uses the same key as your other servers.`);
    else toast.error("That didn't go through. Ask again from the other device.");
  };

  return (
    <Dialog.Root open={!!request} onOpenChange={(open) => { if (!open && request) denyHandover(request); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>Is this your {request?.deviceName}?</Dialog.Title>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p>
              It wants {request?.host} to use the same key as your other servers. Only approve it if it&rsquo;s a
              device you&rsquo;re holding right now.
            </p>
            <div className="flex flex-col items-center gap-1 rounded-md border border-gryt-border p-3">
              <span>Does it show this code?</span>
              <span className="font-mono text-2xl font-semibold tracking-widest">{request?.code}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void approve()}>
                Yes, approve
              </Button>
              <Button tone="neutral" disabled={busy} onClick={() => request && denyHandover(request)}>
                No, that&rsquo;s not mine
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
