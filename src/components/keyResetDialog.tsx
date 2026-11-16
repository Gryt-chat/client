import { Button, Dialog } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { cancelKeyReset, keyResets } from "@/socket";

/**
 * Someone asked to reset your key on a server (GRYT-1886). This device holds the current key, so
 * it's the one that can stop it. "It was me" only closes the window.
 */
export function KeyResetDialog() {
  const resets = keyResets.use();
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const pending = Object.entries(resets).find(([host, r]) => r.holdsCurrentKey && !seen.has(`${host}:${r.at}`));
  const close = () => pending && setSeen(new Set([...seen, `${pending[0]}:${pending[1].at}`]));

  const stop = async () => {
    if (!pending) return;
    setBusy(true);
    const ok = await cancelKeyReset(pending[0]).catch(() => false);
    setBusy(false);
    if (ok) toast.success("Stopped. Your key stays as it is.");
    else toast.error("That didn't go through. Try again in a moment.");
    if (ok) close();
  };

  return (
    <Dialog.Root open={!!pending} onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>Someone asked to reset your key</Dialog.Title>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p>
              On {pending?.[0]}, a device asked to replace your key. It takes over on{" "}
              {pending ? new Date(pending[1].at).toLocaleDateString() : ""} unless you stop it. If it wasn&rsquo;t
              you, stop it and change your password.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button tone="danger" disabled={busy} onClick={() => void stop()}>
                It wasn&rsquo;t me, stop it
              </Button>
              <Button tone="neutral" disabled={busy} onClick={close}>
                It was me
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
