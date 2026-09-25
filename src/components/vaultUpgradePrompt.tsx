import { Button, Dialog, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  getAccountProfile,
  hasMessageKeyHere,
  readSealedVault,
  resealCurrentIdentity,
  type SealedVault,
  upgradeAccountVault,
  useAccount,
  vaultHasRecoverySlot,
} from "@/common";

import {
  type MessagePasswordChoice,
  MessagePasswordSetup,
} from "../packages/settings/src/components/messagePasswordSetup";
import { AccountWordsReveal } from "../packages/settings/src/components/recoveryWords";
import {
  chooseNewPassword,
  dismissUpgradePrompt,
  shouldPromptUpgrade,
  type UpgradeCalls,
  upgradeWithPassword,
} from "./vaultUpgradeState";

const TOAST_ID = "vault-upgrade";

const calls: UpgradeCalls = {
  upgrade: upgradeAccountVault,
  reseal: resealCurrentIdentity,
  read: readSealedVault,
};

type Step = "password" | "short" | "forgot";

/**
 * Asks once, after updating, to move an old message backup to the new lock. A toast
 * rather than a dialog, so it never stands between somebody and the app (GRYT-1498).
 */
export function VaultUpgradePrompt() {
  const { isSignedIn } = useAccount();
  const [grytUserId, setGrytUserId] = useState<string | null>(null);
  const [keyIsHere, setKeyIsHere] = useState(false);
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [answered, setAnswered] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("password");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    void (async () => {
      try {
        const sub = (await getAccountProfile()).sub ?? null;
        if (cancelled || !sub) return;
        setGrytUserId(sub);
        setKeyIsHere(hasMessageKeyHere(sub));
        const v = await readSealedVault();
        if (!cancelled) setVault(v);
      } catch {
        // Nothing to ask about if the account can't be read. Settings says the rest.
      }
    })();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  /** Any way out counts as the answer, and it is kept on this device. */
  const finish = useCallback(() => {
    if (grytUserId) dismissUpgradePrompt(grytUserId);
    toast.dismiss(TOAST_ID);
    setAnswered(true);
    setOpen(false);
    setSecret("");
  }, [grytUserId]);

  const asking = !answered && shouldPromptUpgrade({ grytUserId, keyIsHere, vault });

  useEffect(() => {
    if (!asking || open) return;
    toast(
      () => (
        <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
          <span className="text-sm font-medium">Your message backup can use stronger protection</span>
          <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.5 }}>
            Enter your message password once to upgrade it.
          </span>
          <div className="flex gap-2 justify-end">
            <Button tone="ghost" size="xsmall" onClick={finish}>
              Not now
            </Button>
            <Button
              size="xsmall"
              onClick={() => {
                toast.dismiss(TOAST_ID);
                setStep("password");
                setOpen(true);
              }}
            >
              Upgrade
            </Button>
          </div>
        </div>
      ),
      { id: TOAST_ID, duration: Infinity },
    );
  }, [asking, open, finish]);

  useEffect(() => () => toast.dismiss(TOAST_ID), []);

  const upgrade = useCallback(async () => {
    if (!vault) return;
    if (!secret) return void toast.error("Enter your message password.");
    setBusy(true);
    try {
      const next = await upgradeWithPassword(vault, secret, calls);
      if (next.kind === "short") {
        setVault(next.vault);
        setSecret("");
        setStep("short");
      } else if (next.kind === "done") {
        toast.success("Done. Your message backup uses the new lock now.");
        finish();
      } else if (next.kind === "changed") {
        toast.error("Another device changed your message password in the meantime, so nothing was saved here.");
        finish();
      } else {
        toast.error("Couldn’t save the upgrade. Your backup still opens with the same password.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t open your message backup.");
    } finally {
      setBusy(false);
    }
  }, [vault, secret, finish]);

  const choose = useCallback(async (choice: MessagePasswordChoice) => {
    if (!vault) return;
    setBusy(true);
    try {
      const outcome = await chooseNewPassword(vault, choice, calls);
      if (outcome === "resealed") {
        toast.success("New message password set.");
        finish();
      } else if (outcome === "changed") {
        toast.error("Another device changed your message password in the meantime, so nothing was saved here.");
        finish();
      } else {
        toast.error("Couldn’t save the new password. Your old one still works.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save the message password.");
    } finally {
      setBusy(false);
    }
  }, [vault, finish]);

  if (!open || !vault) return null;

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next && !busy) finish(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[36rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Title>Your message backup can use stronger protection</Dialog.Title>

          {step === "password" && (
            <div className="flex flex-col gap-3">
              <Dialog.Description className="mt-2">
                Your account keeps a locked copy of your message key. It&rsquo;s
                how your messages reach a new device. That copy still uses an
                older lock that&rsquo;s much quicker to crack. Enter your message
                password and Gryt locks it again with the new one. Your password
                stays the same.
              </Dialog.Description>
              <TextField
                type="password"
                label="Message password"
                autoComplete="current-password"
                value={secret}
                disabled={busy}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void upgrade(); }}
              />
              <div className="flex gap-2 flex-wrap">
                <Button size="small" onClick={() => void upgrade()} disabled={busy}>
                  {busy ? "Upgrading…" : "Upgrade"}
                </Button>
                <Button tone="neutral" size="small" onClick={finish} disabled={busy}>
                  Not now
                </Button>
                <Button tone="ghost" size="small" onClick={() => setStep("forgot")} disabled={busy}>
                  Forgotten it?
                </Button>
              </div>
              <div className="flex flex-col gap-2 border-t border-gryt-border pt-3">
                <AccountWordsReveal keyIsHere label="Show my 24 words to save them" />
              </div>
              <span className="text-xs text-gryt-muted">
                Skip it for now and you&rsquo;ll find it in Settings, under Security.
              </span>
            </div>
          )}

          {step === "short" && (
            <div className="flex flex-col gap-3">
              <Dialog.Description className="mt-2">
                Done. Your backup uses the new lock now. But your password is
                under 12 characters, and short ones are the quickest to guess.
                You can choose a longer one here. This device has your message
                key, so you don&rsquo;t need the old one.
              </Dialog.Description>
              <MessagePasswordSetup
                submitLabel="Set new password"
                busy={busy}
                replacesRecoveryKey={vaultHasRecoverySlot(vault)}
                onSubmit={(choice) => void choose(choice)}
                onCancel={finish}
              />
            </div>
          )}

          {step === "forgot" && (
            <div className="flex flex-col gap-3">
              <Dialog.Description className="mt-2">
                This device still has your message key, so you don&rsquo;t need
                the old password. Choose a new one and your backup moves to the
                new lock at the same time.
              </Dialog.Description>
              <MessagePasswordSetup
                submitLabel="Set new password"
                busy={busy}
                replacesRecoveryKey={vaultHasRecoverySlot(vault)}
                onSubmit={(choice) => void choose(choice)}
                onCancel={() => setStep("password")}
              />
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
