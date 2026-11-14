// A contact's key that its own previous key signed over is trusted without a code check; nothing else is.
import assert from "node:assert/strict";

import { deriveDmKeyPair, getPeerPin, type IdentityScope, type PeerPin, pinPeerKey, signDmKeyBinding, verifyDmKeyBinding } from "@gryt/crypto";
import { signKeyHandover } from "@gryt/crypto/key-handover";

const { followSignedHandovers } = await import("../src/packages/socket/src/utils/followHandovers.ts");

const scope = "srv:follow-test" as IdentityScope;
let pins: Record<string, PeerPin> = {};
const store = { read: () => pins, write: (next: Record<string, PeerPin>) => void (pins = next) };
console.warn = () => {};

async function device() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk = { kty, crv, x, y };
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const binding = await signDmKeyBinding({ dmPublicKey: deriveDmKeyPair(seed, scope).publicKey, scope, identityPrivateKey: pair.privateKey, identityPublicJwk: publicJwk });
  const handOverTo = (newBinding: string) => signKeyHandover({ newBinding, scope, identityPrivateKey: pair.privateKey, identityPublicJwk: publicJwk });
  return { binding, handOverTo };
}

const [windows, mac, thief] = await Promise.all([device(), device(), device()]);
const pinned = async (who: string, binding: string) => pinPeerKey(store, scope, who, await verifyDmKeyBinding(binding, scope));

await pinned("sivert", windows.binding);
await followSignedHandovers(store, scope, [{ serverUserId: "sivert", dmKeyBinding: mac.binding, dmKeyHandover: { note: await windows.handOverTo(mac.binding), from: windows.binding } }]);
const after = getPeerPin(store, scope, "sivert");
const macKey = await verifyDmKeyBinding(mac.binding, scope);
assert.equal(after?.thumbprint, macKey.identityThumbprint, "the key the trusted one handed over to is trusted");

await pinned("hrd", windows.binding);
await followSignedHandovers(store, scope, [{ serverUserId: "hrd", dmKeyBinding: thief.binding, dmKeyHandover: { note: await thief.handOverTo(thief.binding), from: thief.binding } }]);
assert.equal(getPeerPin(store, scope, "hrd")?.thumbprint, (await verifyDmKeyBinding(windows.binding, scope)).identityThumbprint, "a note from a key this device never trusted changes nothing");

await pinned("carlo", windows.binding);
await followSignedHandovers(store, scope, [{ serverUserId: "carlo", dmKeyBinding: thief.binding, dmKeyHandover: { note: await windows.handOverTo(mac.binding), from: windows.binding } }]);
assert.equal(getPeerPin(store, scope, "carlo")?.thumbprint, (await verifyDmKeyBinding(windows.binding, scope)).identityThumbprint, "a real note for another key changes nothing");

await pinned("sable", windows.binding);
await followSignedHandovers(store, scope, [{ serverUserId: "sable", dmKeyBinding: mac.binding, dmKeyHandover: null }]);
assert.equal(getPeerPin(store, scope, "sable")?.thumbprint, (await verifyDmKeyBinding(windows.binding, scope)).identityThumbprint, "a change with no note, a wipe or a reset, still asks");

console.log("follow handovers: ok");
