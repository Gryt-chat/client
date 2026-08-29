/* eslint-env node */

/**
 * What a member list does to your pins (GRYT-727).
 *
 * `peer-keys.ts` decides; this is the policy on top of it, and the policy is
 * where the mistakes are. Pinning on a change instead of on a first sighting
 * turns the whole design off and nothing on screen looks different. Pinning
 * your own row means a server that rewrites your key gets it pinned by you.
 * Neither fails loudly, so both are driven here.
 *
 * The policy is imported rather than restated. It lived in the socket package
 * behind a Vite alias at first, which Node cannot resolve, and checking it there
 * meant writing it out again here — where it would have drifted from the app
 * quietly and gone on passing. It moved to `common/auth` for that reason.
 *
 * Real WebCrypto, the real curve library, a faked `localStorage`. Node 24
 * strips the types on import.
 */

import assert from "node:assert/strict";

import { signDmKeyBinding } from "../src/packages/common/src/auth/dm-key-binding.ts";
import { deriveDmKeyPair } from "../src/packages/common/src/auth/dm-keys.ts";
import { asIdentityScope } from "../src/packages/common/src/auth/identity-seed.ts";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { getPeerPin } = await import(
  "../src/packages/common/src/auth/peer-keys.ts"
);
const { evaluateMemberKeys: evaluate } = await import(
  "../src/packages/common/src/auth/member-keys.ts"
);

const SCOPE = asIdentityScope("srv:members");
const seed = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);

async function identity() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: pair.privateKey,
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
}

const base64Url = (bytes) => Buffer.from(bytes).toString("base64url");

const bob = await identity();
const mallory = await identity();

const bind = ({ who = bob, dmSeed = 7 } = {}) =>
  signDmKeyBinding({
    dmPublicKey: deriveDmKeyPair(seed(dmSeed), SCOPE).publicKey,
    scope: SCOPE,
    identityPrivateKey: who.privateKey,
    identityPublicJwk: who.publicJwk,
  });

/** The real policy, with this file's scope and key filled in. */
const evaluateMemberKeys = ({ members, myServerUserId, ownKey = null }) =>
  evaluate({ scope: SCOPE, ownKey, members, myServerUserId });

const ME = "user_me";
const BOB = "user_bob";
const myKey = deriveDmKeyPair(seed(3), SCOPE).publicKey;

/* ── a new member is pinned, without being asked ────────────────────────── */

{
  const states = await evaluateMemberKeys({
    members: [{ serverUserId: BOB, dmKeyBinding: await bind() }],
    myServerUserId: ME,
  });

  assert.equal(states[BOB].decision.kind, "first");
  assert.notEqual(getPeerPin(SCOPE, BOB), null,
    "trust on first use means the first one is taken; there is nobody to ask");
}

/* ── the same one again is quiet ────────────────────────────────────────── */

{
  const states = await evaluateMemberKeys({
    members: [{ serverUserId: BOB, dmKeyBinding: await bind() }],
    myServerUserId: ME,
  });
  assert.equal(states[BOB].decision.kind, "known");
}

/* ── a changed one is reported and NOT pinned ───────────────────────────── */

{
  const before = getPeerPin(SCOPE, BOB).thumbprint;
  const states = await evaluateMemberKeys({
    members: [{ serverUserId: BOB, dmKeyBinding: await bind({ who: mallory }) }],
    myServerUserId: ME,
  });

  assert.equal(states[BOB].decision.kind, "changed");
  assert.equal(getPeerPin(SCOPE, BOB).thumbprint, before,
    "a changed key that gets pinned anyway is the whole design switched off, silently");

  // And again, because a policy that gives in on the second member list gives in.
  await evaluateMemberKeys({
    members: [{ serverUserId: BOB, dmKeyBinding: await bind({ who: mallory }) }],
    myServerUserId: ME,
  });
  assert.equal(getPeerPin(SCOPE, BOB).thumbprint, before);
}

/* ── your own row is never pinned ───────────────────────────────────────── */

{
  const states = await evaluateMemberKeys({
    members: [{ serverUserId: ME, dmKeyBinding: await bind() }],
    myServerUserId: ME,
    ownKey: myKey,
  });

  assert.equal(states[ME].isSelf, true);
  assert.equal(getPeerPin(SCOPE, ME), null,
    "pinning your own row would have you pin whatever the server showed you as yourself");
}

/* ── and it is checked against the key you actually hold ────────────────── */

{
  // The server showing somebody else's key under your id. This is the careless
  // half of a substitution and the only part one person can catch alone.
  const rewritten = await evaluateMemberKeys({
    members: [{ serverUserId: ME, dmKeyBinding: await bind({ dmSeed: 7 }) }],
    myServerUserId: ME,
    ownKey: myKey,
  });
  assert.equal(rewritten[ME].ownKeyRewritten, true,
    "a key under your own id that is not yours has to be noticed");

  const honest = await evaluateMemberKeys({
    members: [{ serverUserId: ME, dmKeyBinding: await bind({ dmSeed: 3 }) }],
    myServerUserId: ME,
    ownKey: myKey,
  });
  assert.equal(honest[ME].ownKeyRewritten, false,
    "and your own key coming back unchanged must not read as tampering");
}

/* ── nothing published is not a problem ─────────────────────────────────── */

{
  const states = await evaluateMemberKeys({
    members: [
      { serverUserId: "user_quiet", dmKeyBinding: null },
      { serverUserId: "user_old" },
    ],
    myServerUserId: ME,
  });

  for (const id of ["user_quiet", "user_old"]) {
    assert.equal(states[id].decision.kind, "none",
      "a member on an older client, or one who has published nothing, is ordinary");
    assert.equal(getPeerPin(SCOPE, id), null);
  }
}

/* ── one bad binding does not stop the rest of the list ─────────────────── */

{
  const states = await evaluateMemberKeys({
    members: [
      { serverUserId: "user_broken", dmKeyBinding: "not.a.binding" },
      { serverUserId: "user_fine", dmKeyBinding: await bind() },
    ],
    myServerUserId: ME,
  });

  assert.equal(states.user_broken.decision.kind, "unusable");
  assert.equal(getPeerPin(SCOPE, "user_broken"), null);
  assert.equal(states.user_fine.decision.kind, "first",
    "a member the server sent garbage for must not cost everybody behind them in the list");
  assert.notEqual(getPeerPin(SCOPE, "user_fine"), null);
}

console.log(
  "member-keys: a new member is pinned, a changed one is not, your own row is never pinned and is checked against the key you hold",
);
