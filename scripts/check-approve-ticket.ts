/* The approve ticket check: only a real, fresh, unseen ticket for this account shows a prompt. */
import assert from "node:assert/strict";

import { checkApproveTicket } from "../src/packages/common/src/auth/approve-ticket.ts";

const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b as ArrayBuffer).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "ca-1" };
const keys = async () => [jwk];
const now = 1_800_000_000_000;

async function ticket(claims: Record<string, string | number> = {}, header: Record<string, string> = {}, key = pair.privateKey) {
  const h = b64(Buffer.from(JSON.stringify({ alg: "ES256", typ: "gryt-approve+jwt", kid: "ca-1", ...header })));
  const p = b64(Buffer.from(JSON.stringify({ purpose: "approve-ask", sub: "me", exp: now / 1000 + 600, jti: crypto.randomUUID(), deviceType: "Windows PC", ...claims })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(sig)}`;
}

const good = await ticket({});
assert.deepEqual(await checkApproveTicket(good, "me", now, keys), { deviceType: "Windows PC" });
assert.equal(await checkApproveTicket(good, "me", now, keys), null, "the same ticket only once");
assert.equal(await checkApproveTicket(await ticket({ sub: "someone" }), "me", now, keys), null, "another account");
assert.equal(await checkApproveTicket(await ticket({ exp: now / 1000 - 1 }), "me", now, keys), null, "expired");
assert.equal(await checkApproveTicket(await ticket({}, { typ: "JWT" }), "me", now, keys), null, "not an approve ticket");
const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
assert.equal(await checkApproveTicket(await ticket({}, {}, other.privateKey), "me", now, keys), null, "signed by someone else");
assert.equal(await checkApproveTicket("a.b.c", "me", now, keys), null, "junk");

assert.ok(await checkApproveTicket(await ticket({}), "me", now, keys));
assert.ok(await checkApproveTicket(await ticket({}), "me", now, keys));
assert.equal(await checkApproveTicket(await ticket({}), "me", now, keys), null, "at most three an hour");
console.log("approve-ticket: ok");
