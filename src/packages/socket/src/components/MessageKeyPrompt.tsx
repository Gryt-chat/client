import { Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  adoptSealedIdentity,
  getAccountProfile,
  hasMessageKeyHere,
  readSealedVault,
  rememberMessageKeyHere,
  sealCurrentIdentity,
  type SealedVault,
  shouldOfferMessageKey,
  writeSealedVault,
} from "@/common";

import { PiKey } from "../../../../lib/icons";

/**
 * The message key, above a direct message. Either taking the account's copy, or
 * making one on an account that has none (GRYT-783, GRYT-1130).
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

    // Who is signed in, and whether they have a sealed copy. Both from the
    // account, so this can be dropped in wherever a DM is drawn.
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
    if (!grytUserId) return;
    if (!secret) return toast.error("Enter your message password.");

    setBusy(true);
    try {
      if (vault) {
        await adoptSealedIdentity(vault, secret);
        toast.success("This device has your message key now. Reload to read older conversations.");
      } else {
        const sealed = await sealCurrentIdentity(secret, "password");
        await writeSealedVault(sealed);
        setVault(sealed);
        toast.success("Saved. Use this password on your other devices.");
      }
      rememberMessageKeyHere(grytUserId);
      setKeyIsHere(true);
      setOpen(false);
      setSecret("");
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
          {offer === "adopt" ? (
            <>
              Your account has a message key this device doesn&rsquo;t hold, so
              conversations from your other devices won&rsquo;t open here. Enter
              your message password to bring them across.
            </>
          ) : (
            <>
              This account has no message password. Sign in somewhere else and
              that device makes its own key, which stops the people you talk to
              from encrypting to you until you set one and use it there.
            </>
          )}
        </p>
      </div>

      {!open ? (
        <div className="flex gap-2">
          <Button size="xsmall" onClick={() => setOpen(true)}>
            {offer === "adopt" ? "Enter it" : "Set a password"}
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
            autoComplete={offer === "adopt" ? "current-password" : "new-password"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <Button size="small" onClick={unlock} disabled={busy}>
            {busy ? "Working…" : offer === "adopt" ? "Unlock" : "Save"}
          </Button>
          <Button tone="ghost" size="small" onClick={() => { setOpen(false); setSecret(""); }} disabled={busy}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
