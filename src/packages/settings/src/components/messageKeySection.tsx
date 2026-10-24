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
  restoreIdentityFromWords,
  type SealedVault,
  writeSealedVault,
} from "@/common";

import { generateSeed, seedToWords } from "../../../common/src/auth/identity-seed";
import { phraseMatches } from "../../../socket/src/lib/confirmPhrase";
import { AccountWordsReveal } from "./recoveryWords";

/**
 * The message key, for signed-in accounts. The password-locked copy on the account is
 * only read and removed here now; nothing makes a new one (GRYT-1871).
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
  const [open, setOpen] = useState<"use" | "reset" | null>(null);
  const [keyIsHere, setKeyIsHere] = useState(false);
  const [confirmReset, setConfirmReset] = useState("");
  const [resetWords, setResetWords] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccountProfile()
      .then((p) => { if (!cancelled && p.sub) setKeyIsHere(hasMessageKeyHere(p.sub)); })
      .catch(() => {});
    readSealedVault()
      .then((v) => { if (!cancelled) setVault(v); })
      // Not surfaced: failing to read this says nothing the person can act on.
      .catch(() => { if (!cancelled) setVault(null); });
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    setSecret("");
    setConfirmReset("");
    setResetWords(false);
  }, []);

  const removeCopy = useCallback(async () => {
    setBusy(true);
    try {
      await writeSealedVault(null);
      setVault(null);
      toast.success("Removed. Your key is only on your devices now.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn\u2019t remove it.");
    } finally {
      setBusy(false);
    }
  }, []);

  /** Take on the key the account's old copy holds, for a device that doesn't have it. */
  const use = useCallback(async () => {
    if (!vault) return;
    if (!secret) return toast.error("Enter your message password or recovery key.");

    setBusy(true);
    try {
      const outcome = await adoptSealedIdentity(vault, secret);
      if (outcome === "upgraded") setVault(await readSealedVault().catch(() => vault));
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setKeyIsHere(true);
      close();
      showAdoptedToast("This device now uses your message key.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the sealed key.");
    } finally {
      setBusy(false);
    }
  }, [vault, secret, close]);

  /** A new key. The old copy on the account holds the old key, so it goes too. */
  const reset = useCallback(async () => {
    if (!phraseMatches(confirmReset, RESET_PHRASE)) {
      return toast.error(`Type "${RESET_PHRASE}" to confirm.`);
    }

    setBusy(true);
    try {
      await restoreIdentityFromWords(seedToWords(generateSeed()));
      if (vault) await writeSealedVault(null);
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setKeyIsHere(true);
      setVault(null);
      close();
      showAdoptedToast("New message key set. Older conversations stay unreadable.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset the message key.");
    } finally {
      setBusy(false);
    }
  }, [confirmReset, vault, close]);

  const guests = guestIdentitiesAtRisk();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">Your message key</span>
        <span className="text-xs text-gryt-muted">
          Your messages are encrypted with a key that lives on your devices. A new
          device gets it when you approve it from one you already use, or from your
          24 words.
        </span>
      </div>

      {vault && keyIsHere && !open && (
        <Alert severity="warning">
          <div className="flex flex-col gap-2">
            <span>
              Your account still has a copy of this key, locked with your old message
              password. Anyone who got hold of the server&rsquo;s database could keep
              guessing that password, so Gryt doesn&rsquo;t keep these anymore. Save your
              24 words below, then remove it.
            </span>
            <div>
              <Button size="small" onClick={() => void removeCopy()} disabled={busy}>
                {busy ? "Removing\u2026" : "Remove it from my account"}
              </Button>
            </div>
          </div>
        </Alert>
      )}

      {vault && !keyIsHere && !open && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gryt-muted">
            Your account has an old copy of your key, locked with your message password.
          </span>
          <Button size="small" onClick={() => setOpen("use")}>
            Use it on this device
          </Button>
        </div>
      )}

      {keyIsHere && !open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">Your 24 words</span>
            <span className="text-xs text-gryt-muted">
              Your message key, written out as 24 words.
            </span>
          </div>
          <AccountWordsReveal keyIsHere={keyIsHere} />
        </div>
      )}

      {!open && vault !== undefined && (
        <div>
          <Button tone="ghost" size="small" onClick={() => setOpen("reset")}>
            Start again with a new key
          </Button>
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
              {/* Three cases, and the third is the one that matters: no record of guest
                  servers doesn't mean there are none. */}
              {guests.certain ? (
                <span>
                  <strong>
                    It also replaces your identity on {guests.count} server
                    {guests.count === 1 ? "" : "s"} you joined without an
                    account.
                  </strong>{" "}
                  You would arrive there as a stranger, and any roles or
                  ownership you had are gone with no way back.{" "}
                  <SaveWordsFirst keyIsHere={keyIsHere} onClick={() => setResetWords(true)} />
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
                  and any roles or ownership there are gone with no way back.{" "}
                  <SaveWordsFirst keyIsHere={keyIsHere} onClick={() => setResetWords(true)} />
                </span>
              )}
            </div>
          </Alert>

          {resetWords && <AccountWordsReveal keyIsHere={keyIsHere} startAt="confirming" />}

          <TextField
            label={`Type \u201c${RESET_PHRASE}\u201d to confirm`}
            value={confirmReset}
            onChange={(e) => setConfirmReset(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="small" tone="danger" onClick={() => void reset()} disabled={busy}>
              Start again
            </Button>
            <Button tone="neutral" size="small" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
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
    </div>
  );
}

/** The reset warning's advice, as a link where this device can actually show the words. */
function SaveWordsFirst({ keyIsHere, onClick }: { keyIsHere: boolean; onClick(): void }) {
  if (!keyIsHere) return <>Save your 24 words first if you want to keep them.</>;
  return (
    <>
      <button
        type="button"
        className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit underline"
        onClick={onClick}
      >
        Save your 24 words first
      </button>{" "}
      if you want to keep them.
    </>
  );
}
