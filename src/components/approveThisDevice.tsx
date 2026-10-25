/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md) */
import { Alert, Button, Dialog, TextField } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { restoreIdentityFromWords } from "@/common";
import { clearRemovedEverywhere, ownHandover, requestKeyReset, useHostsAwaitingApproval } from "@/socket";

import { useLinkDevice } from "../lib/pairing/useLinkDevice";

/**
 * A new device whose key isn't the account's (GRYT-1874): it's approved from another device, or
 * restored from the recovery words, instead of quietly becoming a second you in every DM.
 */
export function ApproveThisDevice() {
  const hosts = useHostsAwaitingApproval();
  const own = ownHandover.use();
  const handover = [...hosts].map((h) => own[h]).find(Boolean);
  const { open: openLinkDevice, isOpen: linking } = useLinkDevice();
  const [later, setLater] = useState(false);
  const [panel, setPanel] = useState<"words" | "fresh" | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    setBusy(true);
    try {
      await restoreIdentityFromWords(words);
      clearRemovedEverywhere();
      toast.success("Your key is on this device now. Reloading…", { duration: 4000 });
      // Anything that already read the old key keeps signing with it until a reload.
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Those words didn't work.");
      setBusy(false);
    }
  };

  const startFresh = async () => {
    setBusy(true);
    const results = await Promise.all([...hosts].map((host) => requestKeyReset(host)));
    setBusy(false);
    const at = results.find((r) => r !== null);
    if (results.every((r) => r !== null) && at) {
      toast.success(`Your key resets on ${new Date(at).toLocaleDateString()}, unless one of your devices stops it.`, { duration: 8000 });
      setLater(true);
    } else toast.error("Some servers didn't take the request. Try again in a moment.");
  };

  return (
    <Dialog.Root open={hosts.size > 0 && !later && !linking} onOpenChange={(open) => { if (!open) setLater(true); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Title>Approve this device from your phone</Dialog.Title>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            <p>
              You&rsquo;re signed in. To open your private messages here too, approve it once from a device you
              already use. Servers and channels work right away; only DMs wait for this.
            </p>
            {handover && !handover.denied && (
              <div className="flex flex-col gap-1 rounded-md border border-gryt-border p-3">
                <span className="font-semibold">Your other device has a request from this one</span>
                <span>
                  Open Gryt there and check it shows <span className="font-mono font-semibold">{handover.code}</span>,
                  then approve. This server then uses the same key as your other servers.
                </span>
              </div>
            )}
            {handover?.denied && (
              <Alert severity="warning">Your other device said no, so nothing changed. If that was a mistake, approve from another device below.</Alert>
            )}
            <Button onClick={openLinkDevice} disabled={busy} tone={handover && !handover.denied ? "neutral" : undefined}>
              Show the code to scan
            </Button>

            {panel === "words" && (
              <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
                <TextField
                  type="password"
                  label="Your 24 words"
                  autoComplete="current-password"
                  placeholder="word word word …"
                  value={words}
                  disabled={busy}
                  onChange={(e) => setWords(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="small" disabled={busy || !words.trim()} onClick={() => void restore()}>
                    Use these words
                  </Button>
                  <Button size="small" tone="neutral" onClick={() => setPanel(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {panel === "fresh" && (
              <div className="flex flex-col gap-2">
                <Alert severity="warning">
                  Only if you&rsquo;ve lost every device and your 24 words. This device&rsquo;s key takes over in 30
                  days. Your devices can stop it until then, so a thief with your password can&rsquo;t do this quietly.
                  Old messages won&rsquo;t come over, and people you message will be asked to check it&rsquo;s you.
                </Alert>
                <div className="flex flex-wrap gap-2">
                  <Button size="small" tone="danger" disabled={busy} onClick={() => void startFresh()}>
                    Reset my key
                  </Button>
                  <Button size="small" tone="neutral" onClick={() => setPanel(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {panel === null && (
              <div className="flex flex-wrap gap-2">
                <Button size="small" tone="neutral" onClick={() => setPanel("words")}>
                  My phone isn&rsquo;t here
                </Button>
                <Button size="small" tone="ghost" onClick={() => setPanel("fresh")}>
                  Lost everything?
                </Button>
              </div>
            )}

            <div>
              <Button size="small" tone="ghost" onClick={() => setLater(true)}>
                Not now
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
