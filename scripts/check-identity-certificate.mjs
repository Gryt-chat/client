/* eslint-env node */

/**
 * Which account a cached certificate is allowed to speak for. Signed in as one
 * account, the client joined as another whose certificate was still valid (GRYT-905).
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
 * And the account is decided before anything else. Every other signal says the
 * certificate is fine, which is what made the wrong identity look normal.
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
 * A laptop off the network answers null. Treating that as "somebody else" would
 * discard the certificate and keypair of the person who is actually there.
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
 * Expiry outranks a key mismatch. Only `wrong-key` clears storage first, and
 * clearing on a renewal that then fails offline throws away the `sub`.
 */
assert.equal(
  certificateVerdict({ ...good, needsRenewal: true, matchesKey: false }),
  "stale",
);

/* ── the caller acts on all four ─────────────────────────────────────────── */

/*
 * A source check, because the verdict being right is worth nothing if the consumer
 * ignores a case. `wrong-account` must also drop the keypair.
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
