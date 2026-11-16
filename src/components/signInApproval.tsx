import { Alert, Button, Dialog, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { accountKeyCall, getValidCertificate, restoreIdentityFromWords, useAccount } from "@/common";

import { getGrytConfig } from "../config";
import { getElectronAPI } from "../lib/electron";
import { useApproveDevice } from "../lib/pairing/useApproveDevice";
import { useLinkDevice } from "../lib/pairing/useLinkDevice";
import { openUserSettings } from "../packages/socket/src/components/dmKeyWarningToast";

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
  const [notMe, setNotMe] = useState(false);
  const [denied, setDenied] = useState(false);
  const { open: openApproveDevice } = useApproveDevice();

  useEffect(() => {
    const onApprove = () => openApproveDevice();
    const onNotMe = () => setNotMe(true);
    const onDenied = () => setDenied(true);
    window.addEventListener("gryt:open-approve-device", onApprove);
    window.addEventListener("gryt:not-me", onNotMe);
    window.addEventListener("gryt:approve-denied", onDenied);
    return () => {
      window.removeEventListener("gryt:open-approve-device", onApprove);
      window.removeEventListener("gryt:not-me", onNotMe);
      window.removeEventListener("gryt:approve-denied", onDenied);
    };
  }, [openApproveDevice]);

  const changePassword = () => {
    const url = `${getGrytConfig().GRYT_OIDC_ISSUER.replace(/\/+$/, "")}/account`;
    const api = getElectronAPI();
    if (api) api.openExternal(url);
    else window.open(url, "_blank", "noopener,noreferrer");
    setNotMe(false);
  };

  useEffect(() => {
    const onNeeded = (e: Event) => setNeeded({ resetAt: (e as CustomEvent<{ resetAt: number | null }>).detail?.resetAt ?? null });
    window.addEventListener("gryt:sign-in-approval", onNeeded);
    return () => window.removeEventListener("gryt:sign-in-approval", onNeeded);
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    void accountKeyCall("status").then(async (s) => {
      if (s?.known && s.resetAt && !s.resetIsYours) setWarning(s.resetAt);
      // One key per account: the first device of a several-key account to get here keeps its key.
      if (s?.known && s.multi && (await accountKeyCall("claim"))?.result === "kept") showKeptKey();
    });
  }, [isSignedIn]);

  const restore = async () => {
    if (busy) return;
    if (!words?.trim()) {
      toast.error("Type your 24 words first.");
      return;
    }
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
    if (busy) return;
    setBusy(true);
    const r = await accountKeyCall("reset");
    setBusy(false);
    if (r?.at) setNeeded({ resetAt: r.at });
    else toast.error("That didn't go through. Try again in a moment.");
  };

  const stop = async () => {
    if (busy) return;
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
            <Dialog.Title>Approve this device</Dialog.Title>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p>Gryt uses one encryption key for all your devices. Your other devices may already show a prompt. If not:</p>
              <ol className="m-0 list-decimal pl-5" style={{ lineHeight: 1.7 }}>
                <li>Open Gryt on one of your other devices.</li>
                <li>Go to Settings, Your devices, Link a device.</li>
                <li>Type the code this device shows, and check the pictures match.</li>
              </ol>
              <p className="m-0 text-gryt-muted">Servers and calls work while you wait. Only your DMs wait for this.</p>
              {needed?.resetAt && (
                <Alert severity="info">
                  This device gets in on {new Date(needed.resetAt).toLocaleDateString()}, unless one of your devices stops it.
                </Alert>
              )}
              <Button onClick={openLinkDevice}>Show the code</Button>
              {words !== null ? (
                <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
                  <TextField type="password" label="Your 24 words" autoComplete="current-password" placeholder="word word word …" value={words} onChange={(e) => setWords(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="small" onClick={() => void restore()}>{busy ? "Checking…" : "Use these words"}</Button>
                    <Button size="small" tone="neutral" onClick={() => setWords(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="small" tone="neutral" onClick={() => setWords("")}>Use my 24 words</Button>
                  {!needed?.resetAt && (
                    <Button size="small" tone="ghost" onClick={() => void reset()}>I&rsquo;ve lost every device</Button>
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
                <Button tone="danger" onClick={() => void stop()}>It wasn&rsquo;t me, stop it</Button>
                <Button tone="neutral" onClick={() => setWarning(null)}>It was me</Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={notMe} onOpenChange={(open) => { if (!open) setNotMe(false); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
            <Dialog.Title>That wasn&rsquo;t you?</Dialog.Title>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p>
                You said you don&rsquo;t know that device. Most likely someone else has your password. The device didn&rsquo;t
                get your key, so it can&rsquo;t read your messages. Change your password so it can&rsquo;t sign in again.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button tone="neutral" onClick={() => setNotMe(false)}>Later</Button>
                <Button onClick={changePassword}>Change password</Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={denied} onOpenChange={(open) => { if (!open) setDenied(false); }}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]">
            <Dialog.Title>Your other device said no</Dialog.Title>
            <div className="mt-3 flex flex-col gap-3 text-sm">
              <p>
                One of your devices answered &ldquo;Not me&rdquo;, so this one wasn&rsquo;t approved. Your DMs stay locked here.
                Servers and calls still work. Pressed it by mistake? Ask again.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button tone="neutral" onClick={() => setDenied(false)}>Close</Button>
                <Button onClick={() => { setDenied(false); void getValidCertificate().catch(() => undefined); }}>Ask again</Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** Once, on the device that kept the account key. Only several-key accounts ever see it. */
function showKeptKey(): void {
  toast(
    (t) => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm font-semibold">This device now holds your account key</span>
        <span className="text-xs" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>
          Gryt now uses one encryption key for all your devices. The next time you use one of your other devices, approve it from this one.
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button tone="neutral" size="xsmall" onClick={() => toast.dismiss(t.id)}>OK</Button>
          <Button size="xsmall" onClick={() => { toast.dismiss(t.id); openUserSettings("devices"); }}>Approve a device</Button>
        </div>
      </div>
    ),
    { id: "kept-account-key", duration: Infinity },
  );
}
