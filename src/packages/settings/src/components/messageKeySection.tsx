import { Alert, Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  adoptSealedIdentity,
  describePasswordProblem,
  readSealedVault,
  sealCurrentIdentity,
  type SealedVault,
  writeSealedVault,
} from "@/common";

/**
 * The message password, for signed-in accounts (GRYT-783).
 *
 * What this fixes: signing in on a second device made a fresh identity for
 * messages. Everything derived from the seed differed, the new device published
 * its key over the old one, and the first device then warned that the server was
 * showing a key that was not yours — a warning about a hostile server, raised by
 * your own laptop.
 *
 * The panel beside this used to say "when you sign in on another device, Gryt
 * restores this identity for you. There is no separate recovery key to save."
 * That was true of the account and not of the messages, and this section is what
 * makes the sentence honest.
 *
 * Guests are not offered this. They already have the 24 words, which do the same
 * job and need nothing stored anywhere — see LocalIdentitySection.
 */
export function MessageKeySection() {
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [open, setOpen] = useState<"set" | "use" | null>(null);
  const [secret, setSecret] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readSealedVault()
      .then((v) => { if (!cancelled) setVault(v); })
      // Not surfaced. Failing to read this says nothing the person can act on,
      // and the section still offers to set one.
      .catch(() => { if (!cancelled) setVault(null); });
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    setSecret("");
    setConfirm("");
  }, []);

  const save = useCallback(async () => {
    const problem = describePasswordProblem(secret);
    if (problem) return toast.error(problem);
    if (secret !== confirm) return toast.error("The two passwords do not match.");

    setBusy(true);
    try {
      const sealed = await sealCurrentIdentity(secret, "password");
      await writeSealedVault(sealed);
      setVault(sealed);
      close();
      toast.success("Message password set.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the message password.");
    } finally {
      setBusy(false);
    }
  }, [secret, confirm, close]);

  /**
   * Take on the identity the account already has.
   *
   * This is the half that makes the promise true. Without it a sealed copy is
   * stored and never used, and "your conversations come with you" would be a
   * sentence about something that had not been built.
   */
  const use = useCallback(async () => {
    if (!vault) return;
    if (!secret) return toast.error("Enter your message password.");

    setBusy(true);
    try {
      await adoptSealedIdentity(vault, secret);
      close();
      toast.success("This device now uses your message key. Reload to see your conversations.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the sealed key.");
    } finally {
      setBusy(false);
    }
  }, [vault, secret, close]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">Message password</span>
        <span className="text-xs text-gryt-muted">
          Your messages are encrypted with a key that lives on this device. Set a
          message password and Gryt keeps a sealed copy of that key on your
          account, so signing in somewhere else brings your conversations with
          you. We cannot open it &mdash; only this password does.
        </span>
      </div>

      {vault && !open && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">
            A sealed copy is saved to your account.
          </span>
          <Button size="small" onClick={() => setOpen("use")}>
            Use it on this device
          </Button>
          <Button tone="neutral" size="small" onClick={() => setOpen("set")}>
            Change it
          </Button>
        </div>
      )}

      {vault === null && !open && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">
            Not set. Signing in on another device will start a new conversation
            history there rather than continuing this one.
          </span>
          <Button size="small" onClick={() => setOpen("set")}>
            Set a message password
          </Button>
        </div>
      )}

      {open === "use" && (
        <div className="flex flex-col gap-3">
          <span className="text-xs text-gryt-muted">
            Enter the message password you set. This device will take on the
            message key your account already has, and your existing
            conversations become readable here.
          </span>

          <TextField
            type="password"
            label="Message password"
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />

          <div className="flex gap-2">
            <Button size="small" onClick={use} disabled={busy}>
              {busy ? "Opening\u2026" : "Use it here"}
            </Button>
            <Button tone="neutral" size="small" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {open === "set" && (
        <div className="flex flex-col gap-3">
          <Alert severity="warning">
            Write it down somewhere safe. Nobody can reset it for you &mdash; not
            us, not a moderator. If you lose it you can start again with a new
            key, and the messages sealed with the old one stay unreadable.
          </Alert>

          <TextField
            type="password"
            label="Message password"
            autoComplete="new-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            helperText="At least 12 characters. Best not to reuse your account password."
          />
          <TextField
            type="password"
            label="Again"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          <div className="flex gap-2">
            <Button size="small" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button tone="neutral" size="small" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
