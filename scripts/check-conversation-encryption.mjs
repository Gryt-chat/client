/* eslint-env node */

/**
 * Whether a conversation gets encrypted, and the round trip when it does
 * (GRYT-729).
 *
 * The decision is the dangerous half. Sealing for everybody except the one
 * member who has not published a key leaves that person unable to read a
 * conversation they are in, and the sender is looking at the text they typed so
 * nothing seems wrong. Sealing to a key that changed is the substitution this
 * whole design exists to refuse, arriving at the one moment it costs something.
 *
 * Real WebCrypto and the real curve library. Node 24 strips the types.
 */

import assert from "node:assert/strict";

import {
  decideSealing,
  openForConversation,
  sealForConversation,
} from "../src/packages/common/src/auth/conversation-encryption.ts";
import { deriveDmKeyPair } from "../src/packages/common/src/auth/dm-keys.ts";
import { asIdentityScope } from "../src/packages/common/src/auth/identity-seed.ts";

const SCOPE = asIdentityScope("srv:seal");
const CONVERSATION = "dm_g0123456789abcdef0123456789abcdef";

const seed = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);
const keysFor = (n) => deriveDmKeyPair(seed(n), SCOPE);

const me = { memberId: "user_me", keys: keysFor(3) };
const bob = { memberId: "user_bob", keys: keysFor(7) };
const carol = { memberId: "user_carol", keys: keysFor(11) };

/** A member whose key this client is happy with. */
const usable = (person) => ({
  memberId: person.memberId,
  keyState: {
    decision: { kind: "known", verified: { dmPublicKey: person.keys.publicKey } },
  },
});

const self = { memberId: me.memberId, publicKey: me.keys.publicKey };

/* ── everybody has a key, so it seals ───────────────────────────────────── */

{
  const decision = decideSealing({ members: [usable(bob), usable(carol)], self });

  assert.equal(decision.kind, "seal");
  assert.equal(decision.recipients.length, 3,
    "the sender goes in the list too, or they cannot read their own message back");
  assert.ok(decision.recipients.some((r) => r.memberId === me.memberId),
    "the sender is missing from their own message");
}

/* ── one member short, and nobody gets it sealed ────────────────────────── */

{
  for (const [label, keyState] of [
    ["published nothing", undefined],
    ["published nothing, explicitly", { decision: { kind: "none" } }],
    ["sent something broken", { decision: { kind: "unusable", reason: "nope" } }],
  ]) {
    const decision = decideSealing({
      members: [usable(bob), { memberId: carol.memberId, keyState }],
      self,
    });

    assert.equal(decision.kind, "plaintext",
      `carol ${label}: sealing for the rest would leave her unable to read a conversation she is in`);
    assert.deepEqual(
      decision.blockedBy.map((b) => b.memberId),
      [carol.memberId],
      "and the composer has to be able to name who, not just say it is unavailable",
    );
  }
}

/* ── a changed key counts as no key ─────────────────────────────────────── */

{
  const decision = decideSealing({
    members: [
      usable(bob),
      {
        memberId: carol.memberId,
        keyState: {
          decision: {
            kind: "changed",
            verified: { dmPublicKey: keysFor(99).publicKey },
            changedIdentity: true,
            changedKey: true,
          },
        },
      },
    ],
    self,
  });

  // The refusal from GRYT-726 arriving where it costs something. Encrypting to
  // the new key would be treating a change this client refused as fine.
  assert.equal(decision.kind, "plaintext");
  assert.equal(decision.blockedBy[0].reason, "changed");
}

/* ── no key of our own ──────────────────────────────────────────────────── */

{
  const decision = decideSealing({ members: [usable(bob)], self: null });

  assert.equal(decision.kind, "plaintext");
  assert.deepEqual(decision.blockedBy, [],
    "a device that has not finished joining is not somebody else's fault, and naming a member for it would be wrong");
}

/* ── the round trip, for everybody in it ────────────────────────────────── */

{
  const decision = decideSealing({ members: [usable(bob), usable(carol)], self });
  const sealed = await sealForConversation({
    plaintext: "the whole group should read this",
    conversationId: CONVERSATION,
    senderKeys: me.keys,
    decision,
  });

  assert.equal(typeof sealed, "string");
  assert.ok(!sealed.includes("the whole group"), "the plaintext is in the envelope");

  for (const person of [me, bob, carol]) {
    assert.equal(
      await openForConversation({
        sealed,
        conversationId: CONVERSATION,
        memberId: person.memberId,
        recipientKeys: person.keys,
      }),
      "the whole group should read this",
      `${person.memberId} could not read it`,
    );
  }
}

/* ── and a plaintext decision seals nothing ─────────────────────────────── */

{
  const sealed = await sealForConversation({
    plaintext: "in the clear",
    conversationId: CONVERSATION,
    senderKeys: me.keys,
    decision: { kind: "plaintext", blockedBy: [] },
  });

  assert.equal(sealed, null,
    "returning an envelope on a plaintext decision would encrypt to a list that was refused");
}

/* ── somebody added afterwards reads nothing, and it is not an error ────── */

{
  const decision = decideSealing({ members: [usable(bob)], self });
  const sealed = await sealForConversation({
    plaintext: "before carol arrived",
    conversationId: CONVERSATION,
    senderKeys: me.keys,
    decision,
  });

  assert.equal(
    await openForConversation({
      sealed,
      conversationId: CONVERSATION,
      memberId: carol.memberId,
      recipientKeys: carol.keys,
    }),
    null,
    "a late joiner has no wrapped key, which a client draws rather than throws",
  );
}

/* ── a broken envelope throws rather than reading as empty ──────────────── */

{
  for (const junk of ["not json", "{}", '{"type":"gryt-sealed-message"}']) {
    await assert.rejects(
      openForConversation({
        sealed: junk,
        conversationId: CONVERSATION,
        memberId: me.memberId,
        recipientKeys: me.keys,
      }),
      undefined,
      `"${junk}" read as an empty message instead of a broken one`,
    );
  }
}

console.log(
  "conversation-encryption: everybody or nobody, a changed key blocks it, and the sender can read their own message back",
);
