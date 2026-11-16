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
    if (!request || busy) return;
    setBusy(true);
    const ok = await approveHandover(request).catch(() => false);
    setBusy(false);
    if (ok) toast.success(`${request.deviceName} can use DMs on ${request.host} now.`);
    else toast.error("That didn't go through. Ask again from the other device.");
  };

  return (
    <Dialog.Root open={!!request} onOpenChange={(open) => { if (!open && request) denyHandover(request); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>Approve {/^(iPhone|iPad|Android phone|Android tablet)$/.test(request?.deviceName ?? "") ? `your ${request?.deviceName}` : request?.deviceName}?</Dialog.Title>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p className="m-0 text-gryt-muted">It wants to use DMs on {request?.host}. Check it shows this code:</p>
            <code className="self-center rounded-[12px] bg-gryt-bg px-4 py-2 font-mono text-[28px] tracking-[0.2em] text-gryt-text">{request?.code}</code>
            <div className="flex flex-wrap justify-end gap-2">
              <Button tone="neutral" onClick={() => { if (!request) return; denyHandover(request, { stop: true }); window.dispatchEvent(new Event("gryt:not-me")); }}>
                That&rsquo;s not mine
              </Button>
              <Button onClick={() => void approve()}>{busy ? "Approving…" : "Approve"}</Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
