/* eslint-env node */

/**
 * Where the sealed seed is stored on the account (GRYT-783).
 *
 * The interesting failure here is not cryptographic, it is destructive. The
 * Keycloak Account API *replaces* the representation rather than patching it,
 * so posting `{ attributes: { grytMessageVault } }` on its own is a request to
 * have no email address and none of whatever else the realm's profile declares.
 * A save that silently unsets somebody's email would look like it worked.
 *
 * So the merge is a pure function and this checks it directly. The request
 * around it is four lines and does not need mocking to be read.
 */

import assert from "node:assert/strict";

import {
  sealedVaultFrom,
  VAULT_ATTRIBUTE,
  withSealedVault,
} from "../src/packages/common/src/auth/message-vault.ts";
import { sealSeed } from "../src/packages/common/src/auth/identity-vault.ts";

const SEED = new Uint8Array(32);
crypto.getRandomValues(SEED);
const vault = await sealSeed(SEED, "a secret", "password");

/** What Keycloak hands back for an account that has been around a while. */
const account = () => ({
  username: "sivert@example.com",
  email: "sivert@example.com",
  emailVerified: true,
  firstName: null,
  attributes: { locale: ["en"] },
});

// ── the whole point: nothing else is lost ───────────────────────────────────
{
  const before = account();
  const after = withSealedVault(before, vault);

  assert.equal(after.email, "sivert@example.com", "email must survive the write");
  assert.equal(after.username, "sivert@example.com", "username must survive");
  assert.equal(after.emailVerified, true, "emailVerified must survive");
  assert.deepEqual(after.attributes.locale, ["en"], "other attributes must survive");
  assert.equal(after.firstName, null, "a null field is still a field");
}

// ── it does not mutate what it was given ────────────────────────────────────
{
  // The caller may retry with the object it read. If this mutated in place, the
  // second attempt would carry the first attempt's changes.
  const before = account();
  withSealedVault(before, vault);
  assert.equal(before.attributes[VAULT_ATTRIBUTE], undefined, "must not write through");
}

// ── the blob round-trips ────────────────────────────────────────────────────
{
  const written = withSealedVault(account(), vault);
  const read = sealedVaultFrom(written);
  assert.deepEqual(read, vault, "what goes in must come back out");
}

// ── an account that has never set one ───────────────────────────────────────
{
  assert.equal(sealedVaultFrom(account()), null);
  assert.equal(sealedVaultFrom({}), null);
  assert.equal(sealedVaultFrom({ attributes: {} }), null);
  assert.equal(sealedVaultFrom({ attributes: { [VAULT_ATTRIBUTE]: [] } }), null);
  assert.equal(sealedVaultFrom({ attributes: { [VAULT_ATTRIBUTE]: [""] } }), null);
}

// ── junk in the attribute is absence, not an exception ──────────────────────
{
  // Somebody else's data, or a half-written value. Reading it must not throw:
  // the person still has to be able to use the device they are on, and the
  // next save overwrites it.
  for (const junk of ["not json at all", "{}", '{"type":"something-else"}', "null", "[]"]) {
    assert.equal(
      sealedVaultFrom({ attributes: { [VAULT_ATTRIBUTE]: [junk] } }),
      null,
      `${junk} must read as absent`,
    );
  }
}

// ── clearing it says "gone" rather than "not mentioned" ─────────────────────
{
  const written = withSealedVault(account(), vault);
  const cleared = withSealedVault(written, null);
  assert.deepEqual(cleared.attributes[VAULT_ATTRIBUTE], [], "clearing must send an empty value");
  assert.equal(sealedVaultFrom(cleared), null);
  assert.equal(cleared.email, "sivert@example.com", "clearing must not lose the email either");
}

// ── an account with no attributes block at all ──────────────────────────────
{
  const written = withSealedVault({ email: "x@example.com" }, vault);
  assert.equal(written.email, "x@example.com");
  assert.deepEqual(sealedVaultFrom(written), vault);
}

console.log("check-message-vault: ok");
