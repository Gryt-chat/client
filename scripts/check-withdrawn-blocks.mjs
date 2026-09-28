/* eslint-env node */

// GRYT-1497 left proof_withdrawn blocks on servers that had proved themselves. They are
// cleared once, and the pin stays, so a server that still offers no proof is refused again.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** localStorage as far as server-pins can tell, with a way to look underneath. */
const items = new Map();
globalThis.localStorage = {
  getItem: (k) => (items.has(k) ? items.get(k) : null),
  setItem: (k, v) => items.set(k, String(v)),
  removeItem: (k) => items.delete(k),
};
const raw = (k) => JSON.parse(items.get(k) ?? "null");

const pins = await import("../src/packages/common/src/auth/server-pins.ts");

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const json64 = (value) => b64(new TextEncoder().encode(JSON.stringify(value)));

/** A server identity key, and what it answers to `server:identify`. */
async function serverKey() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", publicKey);
  const jwk = { kty, crv, x, y };
  const keyId = await pins.jwkThumbprint(jwk);
  const prove = async (nonce) => {
    const input = `${json64({ alg: "ES256", kid: keyId, jwk })}.${json64({ nonce, iss: keyId })}`;
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(input));
    return `${input}.${b64(new Uint8Array(sig))}`;
  };
  return { jwk, keyId, prove };
}

const HOST = "gryt.example:5000";
const OTHER = "other.example:5000";
const server = await serverKey();
const other = await serverKey();
const impostor = await serverKey();
const stranger = await serverKey();

// What a device looks like after GRYT-1497: pinned, then refused on a reconnect.
pins.savePin(server.keyId, server.jwk, HOST);
pins.savePin(other.keyId, other.jwk, OTHER);
pins.applyServerProofDecision(HOST, await pins.evaluateServerProof({ host: HOST, proof: undefined, sentNonce: "n0" }));
pins.blockServer({ host: OTHER, keyId: impostor.keyId, expectedKeyId: other.keyId, blockedAt: 1, reason: "key_mismatch" });
assert.deepEqual(pins.listBlocked().map((b) => b.reason).sort(), ["key_mismatch", "proof_withdrawn"], "the setup did not record both blocks");

// The first launch after the update drops the withdrawn block, and nothing else.
assert.equal(pins.clearWithdrawnBlocksOnce(), 1, "the proof_withdrawn block was not cleared");
assert.deepEqual(pins.listBlocked().map((b) => b.reason), ["key_mismatch"], "a key_mismatch block went with it");
assert.equal(pins.getExpectedKeyIdForHost(HOST), server.keyId, "the host lost its pinned key, so the next connect is trust-on-first-use");
assert.ok(pins.getPin(server.keyId), "the pin itself was dropped");

// The server proves itself with the pinned key: trusted.
assert.equal(
  (await pins.evaluateServerProof({ host: HOST, proof: await server.prove("n1"), sentNonce: "n1" })).action,
  "trusted",
  "the pinned server proving itself was not trusted",
);

// A server that still offers no proof is refused again, and blocked again.
const silent = await pins.evaluateServerProof({ host: HOST, proof: undefined, sentNonce: "n2" });
assert.equal(silent.action, "block");
assert.equal(silent.failure.reason, "proof_withdrawn", "clearing the block let a server with no proof through");
pins.applyServerProofDecision(HOST, silent);

// Another key at the address is still refused, and the key_mismatch block still bites.
const swapped = await pins.evaluateServerProof({ host: HOST, proof: await stranger.prove("n3"), sentNonce: "n3" });
assert.equal(swapped.failure?.reason, "key_mismatch", "a different key at a cleared address was let through");
const known = await pins.evaluateServerProof({ host: OTHER, proof: await impostor.prove("n4"), sentNonce: "n4" });
assert.equal(known.failure?.reason, "blocked", "the key_mismatch block kept through the clear stopped refusing");

// It ran once: the block made just now stays through the next launch.
assert.equal(raw("serverIdentityWithdrawnBlocksCleared"), true, "nothing records that the clear ran");
assert.equal(pins.clearWithdrawnBlocksOnce(), 0, "the clear ran a second time");
assert.ok(
  pins.listBlocked().some((b) => b.reason === "proof_withdrawn" && b.host === HOST),
  "a proof_withdrawn block made after the clear was dropped on the next launch",
);

// The desktop app restores localStorage from its file store, so the clear has to run after that.
const main = readFileSync(join(root, "src/main.tsx"), "utf8");
const init = main.indexOf("initGlobalStorage().then(");
const call = main.indexOf("clearWithdrawnBlocksOnce()");
assert.ok(init >= 0 && call > init, "src/main.tsx clears the blocks before the desktop file store is loaded back over them");

process.stdout.write("withdrawn blocks: cleared once, pins kept, a server with no proof still refused\n");
