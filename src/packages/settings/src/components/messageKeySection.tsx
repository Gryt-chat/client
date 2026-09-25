import { Alert, Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  adoptSealedIdentity,
  getAccountProfile,
  guestIdentitiesAtRisk,
  hasMessageKeyHere,
  readSealedVault,
  rememberMessageKeyHere,
  resealCurrentIdentity,
  resetMessageIdentity,
  sealCurrentIdentity,
  type SealedVault,
  vaultHasRecoverySlot,
  vaultNeedsUpgrade,
  writeSealedVault,
} from "@/common";

import { phraseMatches } from "../../../socket/src/lib/confirmPhrase";
import { type MessagePasswordChoice, MessagePasswordSetup } from "./messagePasswordSetup";

/**
 * The message password, for signed-in accounts. A second device used to publish
 * its key over the first's, which then warned about the server (GRYT-783).
 */

/**
 * Typed back before the key is replaced. Named once so the check and the label
 * cannot drift, which is how they came to disagree.
 */
const RESET_PHRASE = "start again";

// Adopting drops every server session and clears the derived keys, so sending
// breaks until a restart, not only reading. GRYT-1068.
function showAdoptedToast(lead: string): void {
  toast.success(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          {lead} Gryt has to restart before it can send or read encrypted
          messages again.
        </span>
        <Button
          size="small"
          style={{ alignSelf: "flex-end" }}
          onClick={() => window.location.reload()}
        >
          Restart now
        </Button>
      </div>
    ),
    { duration: 30000 },
  );
}

export function MessageKeySection() {
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [open, setOpen] = useState<"set" | "use" | "forgot" | "reset" | null>(null);
  const [keyIsHere, setKeyIsHere] = useState(false);
  const [confirmReset, setConfirmReset] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccountProfile()
      .then((p) => { if (!cancelled && p.sub) setKeyIsHere(hasMessageKeyHere(p.sub)); })
      .catch(() => {});
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
    setConfirmReset("");
  }, []);

  const save = useCallback(async ({ password, recoveryKey }: MessagePasswordChoice) => {
    setBusy(true);
    try {
      const sealed = await sealCurrentIdentity(password, recoveryKey);
      await writeSealedVault(sealed);
      // This device sealed it, so it plainly has the key. Without this the DM
      // prompt would offer to fetch a copy of what it just sent.
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setVault(sealed);
      close();
      toast.success("Message password set.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the message password.");
    } finally {
      setBusy(false);
    }
  }, [close]);

  /** A new password from this device's own key, for "Change it" and "Forgotten it?". */
  const reseal = useCallback(async ({ password, recoveryKey }: MessagePasswordChoice) => {
    if (!vault) return;
    setBusy(true);
    try {
      const outcome = await resealCurrentIdentity(vault, password, recoveryKey);
      setVault(await readSealedVault().catch(() => vault));
      if (outcome === "changed") {
        toast.error("Another device changed your message password in the meantime, so nothing was saved here.");
      } else if (outcome === "restored") {
        toast.error("Couldn\u2019t save the new password. Your old one still works.");
      } else {
        const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
        if (sub) rememberMessageKeyHere(sub);
        setKeyIsHere(true);
        close();
        toast.success("New message password set.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the message password.");
    } finally {
      setBusy(false);
    }
  }, [vault, close]);

  /**
   * Take on the identity the account already has. Without it a sealed copy is
   * stored and never used, and the promise would be about nothing.
   */
  const use = useCallback(async () => {
    if (!vault) return;
    if (!secret) return toast.error("Enter your message password or recovery key.");

    setBusy(true);
    try {
      const outcome = await adoptSealedIdentity(vault, secret);
      if (outcome === "upgraded") setVault(await readSealedVault().catch(() => vault));
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      close();
      showAdoptedToast("This device now uses your message key.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the sealed key.");
    } finally {
      setBusy(false);
    }
  }, [vault, secret, close]);

  const reset = useCallback(async ({ password, recoveryKey }: MessagePasswordChoice) => {
    if (!phraseMatches(confirmReset, RESET_PHRASE)) {
      return toast.error(`Type "${RESET_PHRASE}" to confirm.`);
    }

    setBusy(true);
    try {
      const sealed = await resetMessageIdentity(password, recoveryKey);
      await writeSealedVault(sealed);
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setVault(sealed);
      close();
      showAdoptedToast("New message key set. Older conversations stay unreadable.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset the message key.");
    } finally {
      setBusy(false);
    }
  }, [confirmReset, close]);

  const guests = guestIdentitiesAtRisk();

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
          <Button tone="ghost" size="small" onClick={() => setOpen(keyIsHere ? "forgot" : "reset")}>
            Forgotten it?
          </Button>
        </div>
      )}

      {/* Decision 5's third moment: a device that already holds the key never
          unlocks, so nothing else would ever move its old bundle forward. */}
      {vault && !open && vaultNeedsUpgrade(vault) && (
        <Alert severity="warning">
          Your sealed copy uses an older lock that&rsquo;s much quicker to crack.
          Change the password to move it to the new one. You can add a recovery
          key at the same time.
        </Alert>
      )}

      {vault === null && !open && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">
            Not set. Sign in somewhere else and that device makes its own
            message key, which stops the people you talk to from encrypting to
            you until you set a password here and use it there.
          </span>
          <Button size="small" onClick={() => setOpen("set")}>
            Set a message password
          </Button>
        </div>
      )}

      {/* Decision 3: a device that holds the key needs no old password, so this
          comes before the reset, which loses every conversation. */}
      {open === "forgot" && vault && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">Set a new password</span>
            <span className="text-xs text-gryt-muted">
              This device still has your message key, so you don&rsquo;t need
              the old password. You can still read your conversations here and
              on your other devices.
            </span>
          </div>

          <MessagePasswordSetup
            submitLabel="Set new password"
            busy={busy}
            replacesRecoveryKey={vaultHasRecoverySlot(vault)}
            onSubmit={(choice) => void reseal(choice)}
            onCancel={close}
          />

          <div>
            <Button tone="ghost" size="small" onClick={() => setOpen("reset")} disabled={busy}>
              Start again with a new key instead
            </Button>
          </div>
        </div>
      )}

      {open === "reset" && (
        <div className="flex flex-col gap-3">
          <Alert severity="error">
            <div className="flex flex-col gap-2">
              <span>
                This makes a new message key. Everything already sealed with the
                old one stays unreadable &mdash; on this device and every other.
                Nobody can undo it, including us. That is the same property that
                stops us reading your messages in the first place.
              </span>
              {/* Three cases, and the third is the one that matters. A count
                  of zero used to print nothing at all, so somebody whose
                  history could not be read — or who set this device up from a
                  24-word phrase, which carries no history — was told nothing
                  about the guest servers they were about to lose. */}
              {guests.certain ? (
                <span>
                  <strong>
                    It also replaces your identity on {guests.count} server
                    {guests.count === 1 ? "" : "s"} you joined without an
                    account.
                  </strong>{" "}
                  You would arrive there as a stranger, and any roles or
                  ownership you had are gone with no way back. Save your 24 words
                  first if you want to keep them.
                </span>
              ) : (
                <span>
                  <strong>
                    It also replaces your identity on any server you joined
                    without an account.
                  </strong>{" "}
                  This device has no record of those, which does not mean there
                  are none &mdash; a device set up from a 24-word phrase never
                  has one. You would arrive at any such server as a stranger,
                  and any roles or ownership there are gone with no way back.
                  Save your 24 words first if you want to keep them.
                </span>
              )}
            </div>
          </Alert>

          <MessagePasswordSetup
            submitLabel="Start again"
            tone="danger"
            busy={busy}
            onSubmit={(choice) => void reset(choice)}
            onCancel={close}
          >
            <TextField
              label={`Type \u201c${RESET_PHRASE}\u201d to confirm`}
              value={confirmReset}
              onChange={(e) => setConfirmReset(e.target.value)}
            />
          </MessagePasswordSetup>
        </div>
      )}

      {open === "use" && (
        <div className="flex flex-col gap-3">
          <span className="text-xs text-gryt-muted">
            Enter the message password you set, or your recovery key. This
            device will take on the message key your account already has, and
            your existing conversations become readable here.
          </span>

          <TextField
            type="password"
            label="Message password or recovery key"
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
        <MessagePasswordSetup
          submitLabel="Save"
          busy={busy}
          replacesRecoveryKey={!!vault && vaultHasRecoverySlot(vault)}
          onSubmit={(choice) => void (vault ? reseal(choice) : save(choice))}
          onCancel={close}
        />
      )}
    </div>
  );
}
