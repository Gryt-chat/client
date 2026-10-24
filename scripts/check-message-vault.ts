/**
 * Clearing the old copy on the account (GRYT-1882). The Keycloak Account API *replaces* the
 * representation, so a naive post unsets the email (GRYT-783).
 */

import assert from "node:assert/strict";

import { hasVault, VAULT_ATTRIBUTE, withoutVault } from "../src/packages/common/src/auth/message-vault.ts";

/** What Keycloak hands back for an account that has been around a while. */
const account = () => ({
  username: "sivert@example.com",
  email: "sivert@example.com",
  emailVerified: true,
  firstName: null,
  attributes: { locale: ["en"], [VAULT_ATTRIBUTE]: ['{"type":"gryt-identity-vault","version":2}'] },
});

// ── clearing keeps everything else ──────────────────────────────────────────
{
  const after = withoutVault(account());
  assert.equal(after.email, "sivert@example.com", "email must survive the write");
  assert.equal(after.username, "sivert@example.com", "username must survive");
  assert.equal(after.emailVerified, true, "emailVerified must survive");
  assert.deepEqual(after.attributes?.locale, ["en"], "other attributes must survive");
  assert.equal(after.firstName, null, "a null field is still a field");
  assert.deepEqual(after.attributes?.[VAULT_ATTRIBUTE], [], "clearing sends an empty value, not a missing one");
  assert.equal(hasVault(after), false);
}

// ── it does not mutate what it was given ────────────────────────────────────
{
  const before = account();
  withoutVault(before);
  assert.equal(hasVault(before), true, "must not write through");
}

// ── what counts as a copy ───────────────────────────────────────────────────
{
  assert.equal(hasVault(account()), true);
  assert.equal(hasVault({ attributes: { [VAULT_ATTRIBUTE]: ["any version, still a copy"] } }), true);
  assert.equal(hasVault({}), false);
  assert.equal(hasVault({ attributes: {} }), false);
  assert.equal(hasVault({ attributes: { [VAULT_ATTRIBUTE]: [] } }), false);
  assert.equal(hasVault({ attributes: { [VAULT_ATTRIBUTE]: [""] } }), false);
  assert.deepEqual(withoutVault({ email: "x@example.com" }).attributes, { [VAULT_ATTRIBUTE]: [] });
}

console.log("message-vault: clearing keeps the account, and any non-empty value counts as a copy");
