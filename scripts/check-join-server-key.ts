/**
 * A join is answered only for the server key this connection proved (GRYT-2359): a
 * challenge relayed from another server is refused, or signed for the wrong key.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
});

const { bindChallengeToServer } = await import("@gryt/core");
const { applyServerProofDecision, getExpectedKeyIdForHost } = await import(
  "../src/packages/common/src/auth/server-pins.ts"
);

const HOST = "m.example:5000";
const bind = (serverKey?: string) => bindChallengeToServer(serverKey, getExpectedKeyIdForHost(HOST));

// Nothing proved here yet: an older server with no key signs as before, a key in the challenge is refused.
assert.deepEqual(bind(undefined), { claims: {} });
assert.ok("refuse" in bind("key-of-t"));

// What the guard does once this connection proved key-of-m.
applyServerProofDecision(HOST, { action: "pin", keyId: "key-of-m", jwk: { kty: "EC" } });

assert.deepEqual(bind("key-of-m"), { claims: { server_key: "key-of-m" } });
assert.ok("refuse" in bind("key-of-t"), "a challenge relayed from another server");
assert.deepEqual(bind(undefined), { claims: { server_key: "key-of-m" } }, "a challenge with the key stripped");

const source = readFileSync(new URL("../src/packages/common/src/auth/answer-challenge.ts", import.meta.url), "utf8");
assert.match(source, /bindChallengeToServer\(challenge\.serverKey, getExpectedKeyIdForHost\(host\)\)/);
assert.equal(source.match(/bound\.claims,/g)?.length, 2, "both assertions carry the claim");

console.log("join server key: ok");
