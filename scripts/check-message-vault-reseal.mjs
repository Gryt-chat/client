/* eslint-env node */

/**
 * "Forgotten it?" on a device that holds the key: a new password with no old one, and the
 * old bundle kept until the new one reads back (GRYT-1480). The Keycloak write is faked.
 */

import assert from "node:assert/strict";

import { formatRecoveryKey, generateRecoveryKey } from "@gryt/crypto/recovery-key";

import { openSeed, sealSeed } from "../src/packages/common/src/auth/identity-vault.ts";
import { sealedVaultFrom, VAULT_ATTRIBUTE, withSealedVault } from "../src/packages/common/src/auth/message-vault.ts";
import { resealFromThisDevice } from "../src/packages/common/src/auth/message-vault-upgrade.ts";

const WORDS =
  "abandon amount liar amount expire adjust cage candy arch gather drum bullet " +
  "absurd math era live bid rhythm alien crouch range attend journey unaware";
const SEED = new TextEncoder().encode(WORDS);
const text = (bytes) => new TextDecoder().decode(bytes);

const FORGOTTEN = "the password nobody remembers";
const NEW = "a brand new message password";

/** A Keycloak account, through the same JSON round trip the Account API does. */
function account(initial, { corruptWrites = false, failReads = 0 } = {}) {
  let rep = withSealedVault({ email: "x@example.com", attributes: { locale: ["en"] } }, initial);
  rep = JSON.parse(JSON.stringify(rep));
  const writes = [];
  let reads = 0;
  return {
    writes,
    get current() { return sealedVaultFrom(rep); },
    get rep() { return rep; },
    async read() {
      reads++;
      if (failReads && reads > 1 && failReads-- > 0) throw new Error("network");
      return sealedVaultFrom(JSON.parse(JSON.stringify(rep)));
    },
    async write(vault) {
      writes.push(vault);
      const stored = JSON.parse(JSON.stringify(withSealedVault(rep, vault)));
      if (corruptWrites && vault !== initial) stored.attributes[VAULT_ATTRIBUTE] = ["{\"half\":"];
      rep = stored;
    },
  };
}

// What the account held before: the forgotten password, and a recovery key made then.
const oldRecovery = generateRecoveryKey();
const OLD = JSON.parse(JSON.stringify(await sealSeed(SEED, { password: FORGOTTEN, recoveryKey: oldRecovery })));
assert.equal(text(await openSeed(OLD, formatRecoveryKey(oldRecovery))), WORDS, "the old recovery key opened it before");

// ── the device re-seals under a new password, and a new recovery key ────────
{
  const store = account(OLD);
  const newRecovery = generateRecoveryKey();
  const outcome = await resealFromThisDevice(OLD, SEED, { password: NEW, recoveryKey: newRecovery }, store);
  assert.equal(outcome, "resealed");
  assert.equal(store.writes.length, 1);

  const now = store.current;
  assert.equal(now.version, 2);
  assert.equal(text(await openSeed(now, NEW)), WORDS, "the new password opens it");
  await assert.rejects(() => openSeed(now, FORGOTTEN), /Wrong password/, "the old password stops working");
  await assert.rejects(
    () => openSeed(now, formatRecoveryKey(oldRecovery)),
    /Wrong password/,
    "a recovery key made before stops working",
  );
  assert.equal(text(await openSeed(now, formatRecoveryKey(newRecovery))), WORDS, "one made now works");
  assert.equal(store.rep.email, "x@example.com", "nothing else on the account moved");
  assert.deepEqual(store.rep.attributes.locale, ["en"]);
}

// ── skipping the recovery key leaves no recovery slot at all ────────────────
{
  const store = account(OLD);
  assert.equal(await resealFromThisDevice(OLD, SEED, { password: NEW }, store), "resealed");
  assert.equal(store.current.slots.length, 1);
  assert.equal(store.current.slots[0].kind, "password");
  await assert.rejects(() => openSeed(store.current, formatRecoveryKey(oldRecovery)));
}

// ── the new one does not read back: the old one goes back ───────────────────
{
  const store = account(OLD, { corruptWrites: true });
  assert.equal(await resealFromThisDevice(OLD, SEED, { password: NEW }, store), "restored");
  assert.equal(store.writes.length, 2);
  assert.deepEqual(store.current, OLD, "the account is exactly where it started");
  assert.equal(text(await openSeed(store.current, FORGOTTEN)), WORDS);
  assert.equal(text(await openSeed(store.current, formatRecoveryKey(oldRecovery))), WORDS, "old recovery key too");
}

// ── the read-back itself fails: same, the old one goes back ─────────────────
{
  const store = account(OLD, { failReads: 1 });
  assert.equal(await resealFromThisDevice(OLD, SEED, { password: NEW }, store), "restored");
  assert.deepEqual(store.current, OLD);
}

// ── another device changed it in between: leave theirs alone ────────────────
{
  const theirs = JSON.parse(JSON.stringify(await sealSeed(SEED, { password: "set on the laptop" })));
  const store = account(theirs);
  assert.equal(await resealFromThisDevice(OLD, SEED, { password: NEW }, store), "changed");
  assert.equal(store.writes.length, 0);
  assert.deepEqual(store.current, theirs);
}

// ── nothing on the account any more: nothing written ────────────────────────
{
  const store = account(null);
  assert.equal(await resealFromThisDevice(OLD, SEED, { password: NEW }, store), "changed");
  assert.equal(store.writes.length, 0);
}

console.log("check-message-vault-reseal: a device with the key sets a new password, and a failed write keeps the old one");
