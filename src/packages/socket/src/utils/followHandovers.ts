/* eslint-disable @typescript-eslint/ban-types -- the note's payload is server-relayed input, checked before use */
import { base64Url, base64UrlDecode, getPeerPin, type IdentityScope, markPeerCompared, type PeerPinStore, pinPeerKey, verifyDmKeyBinding } from "@gryt/crypto";
import { verifyKeyHandover } from "@gryt/crypto/key-handover";

export interface SignedHandover {
  /** The note the replaced key signed. */
  note: string;
  /** The binding it replaced. */
  from: string;
}

/**
 * A contact whose pinned key signed its own replacement keeps your trust without a code check.
 * A reset or an admin wipe carries no note, so those still ask.
 */
export async function followSignedHandovers(
  store: PeerPinStore,
  scope: IdentityScope,
  members: readonly { serverUserId: string; dmKeyBinding?: string | null; dmKeyHandover?: SignedHandover | null }[],
): Promise<void> {
  for (const m of members) {
    const handover = m.dmKeyHandover;
    const pin = getPeerPin(store, scope, m.serverUserId);
    if (!handover || !m.dmKeyBinding || !pin) continue;
    try {
      const [old, next] = await Promise.all([verifyDmKeyBinding(handover.from, scope), verifyDmKeyBinding(m.dmKeyBinding, scope)]);
      // Only the key this device trusted can vouch for the next one.
      if (old.identityThumbprint !== pin.thumbprint || base64Url(old.dmPublicKey) !== pin.dmPublicKey) continue;
      await verifyKeyHandover(handover.note, { oldBinding: handover.from, newBinding: m.dmKeyBinding, scope, now: signedAt(handover.note) });
      pinPeerKey(store, scope, m.serverUserId, next);
      if (pin.comparedAt) markPeerCompared(store, scope, m.serverUserId, { thumbprint: next.identityThumbprint, dmPublicKey: base64Url(next.dmPublicKey) });
    } catch (e) {
      console.warn("[Keys] A key handover didn't check out for", m.serverUserId, e);
    }
  }
}

/** Checked as of when it was signed: the expiry guards the server's approval, not what it proves. */
function signedAt(note: string): number {
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(note.split(".")[1] ?? ""))) as { iat?: unknown };
  if (typeof payload.iat !== "number") throw new Error("A key handover says when it was signed.");
  return payload.iat;
}
