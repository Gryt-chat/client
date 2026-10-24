import { Button, Dialog } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  getAccountProfile,
  hasMessageKeyHere,
  readSealedVault,
  type SealedVault,
  useAccount,
  writeSealedVault,
} from "@/common";

import { AccountWordsReveal } from "../packages/settings/src/components/recoveryWords";
import { dismissRemovalPrompt, shouldPromptRemoval } from "./vaultUpgradeState";

const TOAST_ID = "vault-removal";

/**
 * Asks once to save the 24 words and take the password-locked copy off the account
 * (GRYT-1871). A toast rather than a dialog, so it never stands between somebody and the app.
 */
export function VaultUpgradePrompt() {
  const { isSignedIn } = useAccount();
  const [grytUserId, setGrytUserId] = useState<string | null>(null);
  const [keyIsHere, setKeyIsHere] = useState(false);
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [answered, setAnswered] = useState(false);
  const [open, setOpen] = useState(false);
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
    if (grytUserId) dismissRemovalPrompt(grytUserId);
    toast.dismiss(TOAST_ID);
    setAnswered(true);
    setOpen(false);
  }, [grytUserId]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await writeSealedVault(null);
      setVault(null);
      toast.success("Removed. Your key is only on your devices now.");
      finish();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t remove it. Try again in Settings, under Security.");
    } finally {
      setBusy(false);
    }
  }, [finish]);

  const asking = !answered && shouldPromptRemoval({ grytUserId, keyIsHere, vault });

  useEffect(() => {
    if (!asking || open) return;
    toast(
      () => (
        <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
          <span className="text-sm font-medium">Save your 24 words</span>
          <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.5 }}>
            Gryt doesn&rsquo;t keep a password-locked copy of your key on your account anymore.
          </span>
          <div className="flex gap-2 justify-end">
            <Button tone="ghost" size="xsmall" onClick={finish}>
              Not now
            </Button>
            <Button
              size="xsmall"
              onClick={() => {
                toast.dismiss(TOAST_ID);
                setOpen(true);
              }}
            >
              Save them
            </Button>
          </div>
        </div>
      ),
      { id: TOAST_ID, duration: Infinity },
    );
  }, [asking, open, finish]);

  if (!open || !vault) return null;

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next && !busy) finish(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[36rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <Dialog.Title>Save your 24 words</Dialog.Title>
          <div className="flex flex-col gap-3">
            <Dialog.Description className="mt-2">
              Your account still has a copy of your message key, locked with your message
              password. Anyone who got hold of the server&rsquo;s database could keep guessing
              that password, so Gryt is removing these copies. Save your 24 words somewhere
              safe first. With them you can always get your key back.
            </Dialog.Description>
            <AccountWordsReveal keyIsHere label="Show my 24 words" />
            <div className="flex gap-2 flex-wrap">
              <Button size="small" onClick={() => void remove()} disabled={busy}>
                {busy ? "Removing…" : "I’ve saved them, remove the copy"}
              </Button>
              <Button tone="neutral" size="small" onClick={finish} disabled={busy}>
                Not now
              </Button>
            </div>
            <span className="text-xs text-gryt-muted">
              Skip it for now and you&rsquo;ll find it in Settings, under Security.
            </span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
