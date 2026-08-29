/* eslint-env node */

/**
 * A message key wrapped once per member (GRYT-718).
 *
 * Every property here is one somebody's privacy rests on, and almost none of
 * them fails loudly. A message that stayed readable by a person who left, or a
 * ciphertext that could be replayed into another conversation, encrypts and
 * decrypts perfectly well while giving away the thing it exists to protect. So
 * they are asserted against the real WebCrypto and the real curve library
 * rather than reasoned about.
 *
 * Node 24 strips the types on import and provides `crypto.subtle` globally.
 */

import assert from "node:assert/strict";

import { deriveDmKeyPair } from "../src/packages/common/src/auth/dm-keys.ts";
import {
  openMessage,
  sealMessage,
  SEALED_MESSAGE_TYPE,
} from "../src/packages/common/src/auth/message-keys.ts";

const HOST = "chat.example.invalid";
const CONVERSATION = "dm_g0123456789abcdef0123456789abcdef";
const OTHER_CONVERSATION = "dm_gfedcba9876543210fedcba9876543210";

const seed = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);

const alice = { id: "alice", keys: deriveDmKeyPair(seed(7), HOST) };
const bob = { id: "bob", keys: deriveDmKeyPair(seed(11), HOST) };
const carol = { id: "carol", keys: deriveDmKeyPair(seed(13), HOST) };
const mallory = { id: "mallory", keys: deriveDmKeyPair(seed(17), HOST) };

const asRecipient = (p) => ({ memberId: p.id, publicKey: p.keys.publicKey });
const group = [alice, bob, carol].map(asRecipient);

const read = (sealed, person, conversation = CONVERSATION) =>
  openMessage({
    sealed,
    conversationId: conversation,
    memberId: person.id,
    recipientKeys: person.keys,
  });

const seal = (plaintext, recipients = group, sender = alice, conversation = CONVERSATION) =>
  sealMessage({
    plaintext,
    conversationId: conversation,
    senderKeys: sender.keys,
    recipients,
  });

/* ── everybody in the group reads it, including the sender ──────────────── */

{
  const sealed = await seal("the whole group should see this");

  assert.equal(sealed.type, SEALED_MESSAGE_TYPE);
  for (const person of [alice, bob, carol]) {
    assert.equal(
      await read(sealed, person),
      "the whole group should see this",
      `${person.id} could not read a message addressed to them`,
    );
  }
}

/**
 * The sender specifically, because this is the one that looks fine while
 * broken: they are looking at the text they typed, so a client shows the right
 * thing on the way out and nothing on the way back.
 */
{
  const sealed = await seal("can I read my own message");
  assert.equal(await read(sealed, alice), "can I read my own message");
}

/* ── the ciphertext is not the message ──────────────────────────────────── */

{
  const secret = "cleartext would be visible here";
  const sealed = await seal(secret);
  const whole = JSON.stringify(sealed);
  assert.ok(!whole.includes(secret), "the plaintext is sitting in the envelope");
  assert.ok(!whole.includes(Buffer.from(secret).toString("base64url")),
    "the body is base64 of the plaintext rather than of a ciphertext");
}

/* ── somebody outside the conversation gets nothing ─────────────────────── */

{
  const sealed = await seal("not for mallory");
  assert.equal(await read(sealed, mallory), null,
    "a stranger must have no wrapped key at all");

  // And not by borrowing somebody else's slot: the wrap is bound to the member
  // id, so mallory reading through bob's entry has to fail rather than work.
  await assert.rejects(
    openMessage({
      sealed,
      conversationId: CONVERSATION,
      memberId: bob.id,
      recipientKeys: mallory.keys,
    }),
    /operation-specific reason|OperationError|decrypt/i,
    "mallory opened bob's wrapped key",
  );
}

/* ── somebody added later cannot read what came before ──────────────────── */

{
  const beforeCarol = await seal("said before carol arrived", [alice, bob].map(asRecipient));
  assert.equal(await read(beforeCarol, carol), null,
    "a message sent before somebody joined must have no key for them — this is the property that makes adding a member safe");

  const afterCarol = await seal("said after carol arrived");
  assert.equal(await read(afterCarol, carol), "said after carol arrived");
}

/* ── a message cannot be moved into another conversation ────────────────── */

{
  const sealed = await seal("meant for one conversation");
  await assert.rejects(
    read(sealed, bob, OTHER_CONVERSATION),
    "a sealed message replayed into another conversation opened",
  );
}

/* ── tampering fails rather than decrypting to something else ───────────── */

{
  const sealed = await seal("the original text");
  const flipped = { ...sealed, body: sealed.body.slice(0, -1) + (sealed.body.endsWith("A") ? "B" : "A") };
  await assert.rejects(read(flipped, bob), "an edited body decrypted");

  const swapped = {
    ...sealed,
    keys: { ...sealed.keys, [bob.id]: sealed.keys[carol.id] },
  };
  await assert.rejects(read(swapped, bob), "bob opened a key wrapped for carol");
}

/* ── two messages do not share a key ────────────────────────────────────── */

{
  const first = await seal("one");
  const second = await seal("two");

  assert.notEqual(first.keys[bob.id].key, second.keys[bob.id].key,
    "the same wrapped key twice means the content key is not random per message");

  /*
   * And the wrapped bytes differing is not enough on its own — the wrapping IV
   * is random, so a fixed content key still produces different-looking wraps.
   * What has to be true is that one message's key does not open another's body.
   *
   * The wrap is bound to conversation, sender and member, all identical across
   * these two, so lifting the first message's wrapped key into the second's
   * envelope unwraps cleanly. If the content key were shared, the body would
   * then open. It must not.
   */
  await assert.rejects(
    read({ ...second, keys: first.keys }, bob),
    "one message's content key opened another's body, so the key is not per-message",
  );

  /*
   * IVs. Every message to bob is wrapped under the same secret, because
   * dmSharedSecret is deterministic for a conversation — so a repeated wrapping
   * IV is nonce reuse under a fixed key, which is the one way to break AES-GCM
   * outright rather than degrade it.
   */
  assert.notEqual(first.iv, second.iv, "the body IV repeated across two messages");
  assert.notEqual(first.keys[bob.id].iv, second.keys[bob.id].iv,
    "the wrapping IV repeated, and the wrapping key is the same every time");
}

/* ── and each member's copy is its own ──────────────────────────────────── */

{
  const sealed = await seal("one key, three wrappings");
  const wrapped = [alice, bob, carol].map((p) => sealed.keys[p.id].key);
  assert.equal(new Set(wrapped).size, 3,
    "two members with identical wrapped keys means the wrapping ignored who it was for");
}

/* ── the mistakes a caller can make are refused, not shipped ────────────── */

/*
 * Matched on the message rather than just "it threw". Each of these has another
 * guard that would also refuse it — an empty recipient list contains no sender
 * either — so a bare `rejects` passes with the guard under test deleted, and
 * says the wrong thing to whoever hits it.
 *
 * `assert.rejects` takes its second argument as the matcher only when it is a
 * RegExp, a class or a function. A plain string there is the assertion's own
 * message and matches nothing, which is the shape this originally had.
 */
{
  await assert.rejects(seal("nobody", []), /no recipients/,
    "a message to nobody has to say that, not something about the sender");

  await assert.rejects(
    seal("without me", [bob, carol].map(asRecipient)),
    /sender is not among the recipients/,
    "the sender was left out, so they could never read this back",
  );

  await assert.rejects(
    seal("twice", [asRecipient(alice), asRecipient(bob), asRecipient(bob)]),
    /twice/,
    "a duplicated member id silently overwrites one wrapping",
  );

  await assert.rejects(
    openMessage({
      sealed: { ...(await seal("v2 someday")), version: 2 },
      conversationId: CONVERSATION,
      memberId: bob.id,
      recipientKeys: bob.keys,
    }),
    /not a sealed message this version can read/,
    "a version this code does not know was read anyway",
  );
}

console.log(
  "message-keys: the group reads it, the sender reads it back, a stranger and a late joiner get nothing, and it does not move between conversations",
);
