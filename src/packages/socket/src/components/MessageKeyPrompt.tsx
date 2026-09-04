import { Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { PiKey } from "react-icons/pi";

import {
  adoptSealedIdentity,
  getAccountProfile,
  hasMessageKeyHere,
  readSealedVault,
  rememberMessageKeyHere,
  type SealedVault,
  shouldOfferMessageKey,
} from "@/common";

/**
 * Offering this device the message key the account already has (GRYT-783).
 * Above a direct message, because asking at sign-in asks for a password to
 * solve a problem nobody has met yet.
 *
 * Silent unless there is something to offer — including **while the answer is
 * still loading**, rather than flashing a password box and withdrawing it.
 */
export function MessageKeyPrompt() {
  const [grytUserId, setGrytUserId] = useState<string | null>(null);
  const [vault, setVault] = useState<SealedVault | null | undefined>(undefined);
  const [keyIsHere, setKeyIsHere] = useState(true);
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Who is signed in, and whether they have a sealed copy. Both come from the
    // account rather than from props, so this can be dropped in wherever a DM
    // is drawn without threading auth state through the tree.
    void (async () => {
      let sub: string | null = null;
      try {
        sub = (await getAccountProfile()).sub ?? null;
      } catch {
        // Not signed in. A guest has the 24 words and is never offered this.
      }
      if (cancelled) return;
      setGrytUserId(sub);
      if (!sub) {
        setVault(null);
        return;
      }

      setKeyIsHere(hasMessageKeyHere(sub));
      try {
        const v = await readSealedVault();
        if (!cancelled) setVault(v);
      } catch {
        // Treated as "nothing to offer". A network hiccup should not put a
        // password prompt in front of somebody mid-conversation.
        if (!cancelled) setVault(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const unlock = useCallback(async () => {
    if (!vault || !grytUserId) return;
    if (!secret) return toast.error("Enter your message password.");

    setBusy(true);
    try {
      await adoptSealedIdentity(vault, secret);
      rememberMessageKeyHere(grytUserId);
      setKeyIsHere(true);
      setOpen(false);
      setSecret("");
      toast.success("This device has your message key now. Reload to read older conversations.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the sealed key.");
    } finally {
      setBusy(false);
    }
  }, [vault, secret, grytUserId]);

  const offer = shouldOfferMessageKey({
    signedIn: grytUserId !== null,
    vaultExists: vault === undefined ? null : vault !== null,
    keyIsHere,
  });
  if (!offer || dismissed) return null;

  return (
    <div
      className="flex flex-col gap-2"
      style={{
        marginBottom: "12px",
        padding: "10px 12px",
        borderRadius: "var(--gryt-radius-md)",
        border: "1px solid var(--gryt-neutral-6)",
        background: "var(--gryt-surface-raised)",
      }}
    >
      <div className="flex items-start gap-2">
        <PiKey aria-hidden="true" size={14} style={{ color: "var(--gryt-accent)", flexShrink: 0, marginTop: "2px" }} />
        <p className="m-0 text-xs" style={{ color: "var(--gryt-neutral-11)", lineHeight: 1.5 }}>
          Your account has a message key this device doesn&rsquo;t hold, so
          conversations from your other devices won&rsquo;t open here. Enter your
          message password to bring them across.
        </p>
      </div>

      {!open ? (
        <div className="flex gap-2">
          <Button size="xsmall" onClick={() => setOpen(true)}>
            Enter it
          </Button>
          {/* For the session only. Not persisted: it is still true tomorrow,
              and quietly agreeing never to mention it again is how somebody
              ends up with two halves of their history and no explanation. */}
          <Button tone="ghost" size="xsmall" onClick={() => setDismissed(true)}>
            Not now
          </Button>
        </div>
      ) : (
        <div className="flex items-end gap-2 flex-wrap">
          <TextField
            type="password"
            size="small"
            label="Message password"
            autoComplete="current-password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <Button size="small" onClick={unlock} disabled={busy}>
            {busy ? "Opening…" : "Unlock"}
          </Button>
          <Button tone="ghost" size="small" onClick={() => { setOpen(false); setSecret(""); }} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
