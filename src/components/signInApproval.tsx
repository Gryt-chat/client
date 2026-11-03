import { Alert, Button, Dialog, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { accountKeyCall, restoreIdentityFromWords, useAccount } from "@/common";

import { useLinkDevice } from "../lib/pairing/useLinkDevice";

/**
 * Signing in needs a device that already has your key (GRYT-2016): this one doesn't, so it's linked,
 * restored from the words, or reset over 30 days. A device that has the key is told about a reset.
 */
export function SignInApproval() {
  const { isSignedIn } = useAccount();
  const { open: openLinkDevice, isOpen: linking } = useLinkDevice();
  const [needed, setNeeded] = useState<{ resetAt: number | null } | null>(null);
  const [warning, setWarning] = useState<number | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onNeeded = (e: Event) => setNeeded({ resetAt: (e as CustomEvent<{ resetAt: number | null }>).detail?.resetAt ?? null });
    window.addEventListener("gryt:sign-in-approval", onNeeded);
    return () => window.removeEventListener("gryt:sign-in-approval", onNeeded);
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    void accountKeyCall("status").then((s) => {
      if (s?.known && s.resetAt && !s.resetIsYours) setWarning(s.resetAt);
    });
  }, [isSignedIn]);

  const restore = async () => {
    setBusy(true);
    try {
      await restoreIdentityFromWords(words ?? "");
      toast.success("Your key is on this device now. Reloading…", { duration: 4000 });
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Those words didn't work.");
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    const r = await accountKeyCall("reset");
    setBusy(false);
    if (r?.at) setNeeded({ resetAt: r.at });
    else toast.error("That didn't go through. Try again in a moment.");
  };

  const stop = async () => {
    setBusy(true);
    const r = await accountKeyCall("reset/cancel");
    setBusy(false);
    if (r?.ok) {
      toast.success("Stopped. Change your password if that wasn't you.");
      setWarning(null);
    } else toast.error("That didn't go through. Try again in a moment.");
  };

  return (
    <>
      <Dialog.Root open={!!needed && !linking} onOpenChange={(open) => { if (!open) setNeeded(null); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <Dialog.Title>Approve this sign-in</Dialog.Title>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p>
                Your password is right, but your account only lets in devices you&rsquo;ve approved. Scan the code
                with a phone or computer that&rsquo;s already signed in.
              </p>
              {needed?.resetAt && (
                <Alert severity="info">
                  This device gets in on {new Date(needed.resetAt).toLocaleDateString()}, unless one of your devices stops it.
                </Alert>
              )}
              <Button onClick={openLinkDevice} disabled={busy}>Show the code to scan</Button>
              {words !== null ? (
                <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
                  <TextField type="password" label="Your 24 words" autoComplete="current-password" placeholder="word word word …" value={words} disabled={busy} onChange={(e) => setWords(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="small" disabled={busy || !words.trim()} onClick={() => void restore()}>Use these words</Button>
                    <Button size="small" tone="neutral" onClick={() => setWords(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="small" tone="neutral" onClick={() => setWords("")}>Use my 24 words</Button>
                  {!needed?.resetAt && (
                    <Button size="small" tone="ghost" disabled={busy} onClick={() => void reset()}>I&rsquo;ve lost every device</Button>
                  )}
                </div>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={warning !== null} onOpenChange={(open) => { if (!open) setWarning(null); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
            <Dialog.Title>Someone is trying to sign in as you</Dialog.Title>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p>
                A device without your key said it lost every other device. It gets into your account on{" "}
                {warning ? new Date(warning).toLocaleDateString() : ""} unless you stop it. If that wasn&rsquo;t you,
                stop it and change your password.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button tone="danger" disabled={busy} onClick={() => void stop()}>It wasn&rsquo;t me, stop it</Button>
                <Button tone="neutral" disabled={busy} onClick={() => setWarning(null)}>It was me</Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
