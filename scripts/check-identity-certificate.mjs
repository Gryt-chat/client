/* eslint-env node */

/**
 * Which account a cached certificate is allowed to speak for (GRYT-905).
 *
 * The bug this exists to stop: signed in as one account, the client joined a
 * server as a different one — the owner — because the certificate left over
 * from that account was still in date and still matched the key on the device.
 * `answer-challenge.ts` signs its assertion with the `sub` it reads out of the
 * certificate, so the server was handed a real certificate, a real signature
 * and the wrong person, and nothing it could check would have caught it.
 *
 * `certificateVerdict` has no imports precisely so it can be run here. The
 * module that uses it needs Keycloak, IndexedDB, `fetch` and a keychain, which
 * is how the rule went unchecked long enough for that to ship.
 *
 * Run against the real module rather than a copy — Node strips the types on
 * import, which is why this lives in .mjs and the source stays .ts.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { certificateVerdict } from "../src/packages/common/src/auth/certificate-verdict.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const ME = "3f2a-root";
const SOMEBODY_ELSE = "9c81-test";

/** A certificate that is ours, current, and matches the key we hold. */
const good = {
  certificateSub: ME,
  signedInSub: ME,
  matchesKey: true,
  needsRenewal: false,
};

/* ── the ordinary case still works ───────────────────────────────────────── */

assert.equal(certificateVerdict(good), "use");

/* ── somebody else's certificate is never used ───────────────────────────── */

assert.equal(
  certificateVerdict({ ...good, signedInSub: SOMEBODY_ELSE }),
  "wrong-account",
  "a certificate for another account must not be used",
);

/*
 * And the account is decided before anything else.
 *
 * This is the assertion that pins the bug. Every other signal says the
 * certificate is fine — in date, key matches — and it is those signals passing
 * that made the wrong identity look like a normal join.
 */
assert.equal(
  certificateVerdict({
    certificateSub: ME,
    signedInSub: SOMEBODY_ELSE,
    matchesKey: true,
    needsRenewal: false,
  }),
  "wrong-account",
  "a matching key and a live certificate must not outvote the wrong account",
);

/* An expired certificate belonging to somebody else is still theirs. It has to
 * take the keypair with it, and `stale` does not. */
assert.equal(
  certificateVerdict({ ...good, signedInSub: SOMEBODY_ELSE, needsRenewal: true }),
  "wrong-account",
);
assert.equal(
  certificateVerdict({ ...good, signedInSub: SOMEBODY_ELSE, matchesKey: false }),
  "wrong-account",
);

/* ── not knowing who is signed in is not a mismatch ──────────────────────── */

/*
 * The failure mode on the other side: a laptop off the network, or a session
 * that lapsed while the app was open, answers null. Treating that as "somebody
 * else" would discard the certificate *and* the keypair of the person who is
 * actually there, on the strength of a failed token refresh.
 */
assert.equal(
  certificateVerdict({ ...good, signedInSub: null }),
  "use",
  "an unknown signed-in account must not discard a usable certificate",
);
assert.equal(certificateVerdict({ ...good, signedInSub: null, needsRenewal: true }), "stale");
assert.equal(certificateVerdict({ ...good, signedInSub: null, matchesKey: false }), "wrong-key");

/* A certificate whose own `sub` cannot be read is not ours to trust. */
assert.equal(certificateVerdict({ ...good, certificateSub: null }), "wrong-account");

/* ── the two repairable states stay distinct ─────────────────────────────── */

assert.equal(certificateVerdict({ ...good, needsRenewal: true }), "stale");
assert.equal(certificateVerdict({ ...good, matchesKey: false }), "wrong-key");

/*
 * Expiry outranks a key mismatch. Both end in a fetch, but only `wrong-key`
 * clears storage first, and clearing on a renewal that then fails offline
 * would throw away the `sub` `getCertificateSub` reads back out of it.
 */
assert.equal(
  certificateVerdict({ ...good, needsRenewal: true, matchesKey: false }),
  "stale",
);

/* ── the caller acts on all four ─────────────────────────────────────────── */

/*
 * A source check, because the verdict being right is worth nothing if the
 * consumer ignores a case. `wrong-account` is the one that must also drop the
 * keypair: a new certificate minted over the previous account's key binds two
 * accounts to one key, and a server that pinned it sees the same key arrive
 * under a second name.
 */
const source = readFileSync(
  join(HERE, "../src/packages/common/src/auth/identity-certificate.ts"),
  "utf8",
);

assert.ok(
  source.includes("certificateVerdict("),
  "getValidCertificate must decide with certificateVerdict rather than its own rule",
);

for (const state of ["use", "wrong-account", "wrong-key"]) {
  assert.ok(
    source.includes(`"${state}"`),
    `identity-certificate.ts does not handle the ${state} verdict`,
  );
}

const wrongAccountBranch = source.slice(
  source.indexOf('verdict === "wrong-account"'),
  source.indexOf('verdict === "wrong-key"'),
);
assert.ok(
  wrongAccountBranch.includes("clearIdentityCertificate()"),
  "a certificate belonging to another account must be discarded",
);
assert.ok(
  wrongAccountBranch.includes("clearIdentityKeys()"),
  "a certificate belonging to another account must take the keypair with it, " +
    "or the next certificate binds a second account to the first one's key",
);

console.log("check-identity-certificate: ok");
