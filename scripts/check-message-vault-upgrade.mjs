/* eslint-env node */

/**
 * Moving an old bundle to version 2 when somebody unlocks it. Nothing is deleted, and the
 * old one stays until the new one reads back and opens (GRYT-1473, decision 5).
 */

import assert from "node:assert/strict";

import { openSeed, sealSeed } from "../src/packages/common/src/auth/identity-vault.ts";
import { sealedVaultFrom, VAULT_ATTRIBUTE, withSealedVault } from "../src/packages/common/src/auth/message-vault.ts";
import { upgradeSealedVault } from "../src/packages/common/src/auth/message-vault-upgrade.ts";

const WORDS =
  "abandon amount liar amount expire adjust cage candy arch gather drum bullet " +
  "absurd math era live bid rhythm alien crouch range attend journey unaware";
const text = (bytes) => new TextDecoder().decode(bytes);

// Sealed by identity-vault.ts at b215c594, the last version 1 client.
const V1 = {"type":"gryt-identity-vault","version":1,"kdf":"PBKDF2-SHA256","iterations":600000,"secretKind":"password","salt":"ya-E99aPOrPB9cVWHRAN0A","iv":"LpB5rtziarP9gIDY","data":"H-1uwG7cQpsTN4M1SX7HZnL8iuXix7CDLdSo5Mq2pdRdIl0elisAc6SEIkXCwQveDe6bi05vufkt18jDz61oW3CedQ9oIaYBa2qGb3UMa5523pxrXRNMoWPduZyL8Z6o7zLkIkTagj6UIZJ6_XCw8CQJRsp5flXRP2MRwa1u-nIsyrjysMWdoiwug6aVSh7B1RbaG3wXFNxT-dLT7WIIlfjSO2Fx"};
const SECRET = "hunter2x";

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
      let stored = JSON.parse(JSON.stringify(withSealedVault(rep, vault)));
      if (corruptWrites && vault.version === 2) stored.attributes[VAULT_ATTRIBUTE] = ["{\"half\":"];
      rep = stored;
    },
  };
}

// ── the ordinary case: opens, re-seals, opens again ─────────────────────────
{
  const store = account(V1);
  const old = await store.read();
  assert.equal(await upgradeSealedVault(old, SECRET, store), "upgraded");
  assert.equal(store.current.version, 2, "the account holds version 2 now");
  assert.equal(store.current.slots[0].kdf, "argon2id");
  assert.equal(store.current.secretKind, "password");
  assert.equal(text(await openSeed(store.current, SECRET)), WORDS, "and it opens with the same password");
  assert.equal(store.rep.email, "x@example.com", "nothing else on the account moved");
  assert.deepEqual(store.rep.attributes.locale, ["en"]);

  // Opening it again does nothing: version 2 is current.
  assert.equal(await upgradeSealedVault(store.current, SECRET, store), "current");
  assert.equal(store.writes.length, 1);
}

// ── a wrong secret writes nothing ───────────────────────────────────────────
{
  const store = account(V1);
  await assert.rejects(() => upgradeSealedVault(V1, "hunter2X", store), /Wrong password/);
  assert.equal(store.writes.length, 0);
  assert.deepEqual(store.current, V1);
}

// ── another device changed it in between: leave theirs alone ────────────────
{
  const theirs = await sealSeed(new TextEncoder().encode(WORDS), { password: "their new password" });
  const store = account(theirs);
  assert.equal(await upgradeSealedVault(V1, SECRET, store), "changed");
  assert.equal(store.writes.length, 0);
  assert.deepEqual(store.current, JSON.parse(JSON.stringify(theirs)));
}

// ── the new one does not read back: the old one goes back ───────────────────
{
  const store = account(V1, { corruptWrites: true });
  assert.equal(await upgradeSealedVault(V1, SECRET, store), "restored");
  assert.equal(store.writes.length, 2);
  assert.deepEqual(store.current, V1, "the account is exactly where it started");
  assert.equal(text(await openSeed(store.current, SECRET)), WORDS);
}

// ── the read-back itself fails: same, the old one goes back ─────────────────
{
  const store = account(V1, { failReads: 1 });
  // First read is the compare, second is the read-back that fails.
  assert.equal(await upgradeSealedVault(V1, SECRET, store), "restored");
  assert.deepEqual(store.current, V1);
}

// ── a device on the old client still sees the new bundle as a vault ─────────
{
  // isSealedVault at b215c594. Failing it, that device would offer to set a password
  // over this one. Passing it, opening says "written by a newer version of Gryt".
  const store = account(V1);
  await upgradeSealedVault(V1, SECRET, store);
  const raw = JSON.parse(store.rep.attributes[VAULT_ATTRIBUTE][0]);
  const oldIsSealedVault = (v) => !!v && v.type === "gryt-identity-vault" && typeof v.salt === "string" && typeof v.data === "string";
  assert.ok(oldIsSealedVault(raw));
  assert.notEqual(raw.version, 1, "and the old client refuses anything that is not version 1");
  assert.ok(store.rep.attributes[VAULT_ATTRIBUTE][0].length < 8192, "fits the attribute's limit in the user profile");
}

console.log("check-message-vault-upgrade: old bundles re-seal, and a failed write leaves the old one in place");
