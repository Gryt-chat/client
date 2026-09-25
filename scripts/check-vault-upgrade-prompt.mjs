/* eslint-env node */

/**
 * The one-time prompt to move an old backup to Argon2id: who is asked, that "not now"
 * sticks, and which call each answer makes. Keycloak is a fake store here (GRYT-1498).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { formatRecoveryKey, generateRecoveryKey } from "@gryt/crypto/recovery-key";

/* Node has no localStorage. A Map behind the same calls, installed before anything reads it. */
const storage = new Map();
let storageBroken = false;
globalThis.localStorage = {
  getItem: (key) => {
    if (storageBroken) throw new DOMException("denied", "SecurityError");
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem: (key, value) => {
    if (storageBroken) throw new DOMException("denied", "SecurityError");
    storage.set(key, String(value));
  },
  removeItem: (key) => void storage.delete(key),
};

const { openSeed, sealSeed, vaultNeedsUpgrade } = await import("../src/packages/common/src/auth/identity-vault.ts");
const { sealedVaultFrom, VAULT_ATTRIBUTE, withSealedVault } = await import("../src/packages/common/src/auth/message-vault.ts");
const { resealFromThisDevice, upgradeSealedVault } = await import("../src/packages/common/src/auth/message-vault-upgrade.ts");
const {
  chooseNewPassword,
  dismissUpgradePrompt,
  passwordIsShort,
  shouldPromptUpgrade,
  upgradePromptDismissed,
  upgradeWithPassword,
} = await import("../src/components/vaultUpgradeState.ts");

const WORDS =
  "abandon amount liar amount expire adjust cage candy arch gather drum bullet " +
  "absurd math era live bid rhythm alien crouch range attend journey unaware";
const SEED = new TextEncoder().encode(WORDS);
const text = (bytes) => new TextDecoder().decode(bytes);
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");

// Sealed by identity-vault.ts at b215c594, the last version 1 client. Password "hunter2x".
const V1_SHORT = {"type":"gryt-identity-vault","version":1,"kdf":"PBKDF2-SHA256","iterations":600000,"secretKind":"password","salt":"ya-E99aPOrPB9cVWHRAN0A","iv":"LpB5rtziarP9gIDY","data":"H-1uwG7cQpsTN4M1SX7HZnL8iuXix7CDLdSo5Mq2pdRdIl0elisAc6SEIkXCwQveDe6bi05vufkt18jDz61oW3CedQ9oIaYBa2qGb3UMa5523pxrXRNMoWPduZyL8Z6o7zLkIkTagj6UIZJ6_XCw8CQJRsp5flXRP2MRwa1u-nIsyrjysMWdoiwug6aVSh7B1RbaG3wXFNxT-dLT7WIIlfjSO2Fx"};
const SHORT = "hunter2x";

/** A version 1 bundle under any password, sealed the way the old client did, at few iterations. */
async function sealV1(password, iterations = 1000) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const aad = new TextEncoder().encode("gryt-identity-vault:v1");
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, SEED));
  return { type: "gryt-identity-vault", version: 1, kdf: "PBKDF2-SHA256", iterations, secretKind: "password", salt: b64u(salt), iv: b64u(iv), data: b64u(data) };
}

const LONG = "a long enough message password";
const V1_LONG = await sealV1(LONG);
assert.equal(text(await openSeed(V1_LONG, LONG)), WORDS, "the hand-sealed version 1 bundle opens the way the old ones do");
const V2 = JSON.parse(JSON.stringify(await sealSeed(SEED, { password: LONG })));

/** A Keycloak account, through the same JSON round trip the Account API does. */
function account(initial) {
  let rep = JSON.parse(JSON.stringify(withSealedVault({ email: "x@example.com", attributes: {} }, initial)));
  const writes = [];
  return {
    writes,
    get current() { return sealedVaultFrom(rep); },
    async read() { return sealedVaultFrom(JSON.parse(JSON.stringify(rep))); },
    async write(vault) {
      writes.push(vault);
      rep = JSON.parse(JSON.stringify(withSealedVault(rep, vault)));
      assert.ok(rep.attributes[VAULT_ATTRIBUTE].length === 1);
    },
  };
}

/** The calls the prompt makes, over the real upgrade and re-seal code, counting which ran. */
function callsFor(store) {
  const made = { upgrade: 0, reseal: 0 };
  return {
    made,
    calls: {
      upgrade: (vault, secret) => { made.upgrade++; return upgradeSealedVault(vault, secret, store); },
      reseal: (vault, password, recoveryKey) => {
        made.reseal++;
        return resealFromThisDevice(vault, SEED, { password, recoveryKey }, store);
      },
      read: () => store.read(),
    },
  };
}

// ── who is asked ────────────────────────────────────────────────────────────
{
  assert.ok(vaultNeedsUpgrade(V1_SHORT) && vaultNeedsUpgrade(V1_LONG) && !vaultNeedsUpgrade(V2));

  const ask = (grytUserId, keyIsHere, vault) => shouldPromptUpgrade({ grytUserId, keyIsHere, vault });
  assert.equal(ask("alice", true, V1_SHORT), true, "old format, key on this device: asked");
  assert.equal(ask("alice", true, V1_LONG), true);
  assert.equal(ask("alice", true, V2), false, "already Argon2id: never asked");
  assert.equal(ask("alice", false, V1_SHORT), false, "this device lacks the key: never asked");
  assert.equal(ask("alice", true, null), false, "no backup on the account");
  assert.equal(ask("alice", true, undefined), false, "still loading: quiet, no flicker");

  // A guest has no account, so no id, whatever else is lying around.
  for (const keyIsHere of [true, false]) {
    for (const vault of [V1_SHORT, V2, null, undefined]) {
      assert.equal(ask(null, keyIsHere, vault), false, "a guest is never asked");
    }
  }
}

// ── "not now" sticks, per account ───────────────────────────────────────────
{
  assert.equal(upgradePromptDismissed("bob"), false);
  dismissUpgradePrompt("bob");
  assert.equal(upgradePromptDismissed("bob"), true);
  assert.equal(shouldPromptUpgrade({ grytUserId: "bob", keyIsHere: true, vault: V1_SHORT }), false, "dismissed stays dismissed");
  assert.equal(
    shouldPromptUpgrade({ grytUserId: "carol", keyIsHere: true, vault: V1_SHORT }),
    true,
    "another account on the same device is still asked",
  );
  assert.equal(storage.get("gryt_vault_upgrade_dismissed:bob"), "1", "kept in storage, so it survives a restart");

  storageBroken = true;
  assert.doesNotThrow(() => dismissUpgradePrompt("dave"), "a denied write is not an error");
  assert.equal(upgradePromptDismissed("bob"), false, "unreadable storage asks again rather than hiding it");
  storageBroken = false;
}

// ── the short-password test counts characters ───────────────────────────────
assert.equal(passwordIsShort(SHORT), true);
assert.equal(passwordIsShort("x".repeat(11)), true);
assert.equal(passwordIsShort("x".repeat(12)), false);
assert.equal(passwordIsShort("\u{1F511}".repeat(11)), true, "eleven emoji are eleven characters, not 22");
assert.equal(passwordIsShort("\u{1F511}".repeat(12)), false);

// ── a long password: upgraded, done, no new password offered ────────────────
{
  const store = account(V1_LONG);
  const { calls, made } = callsFor(store);
  assert.deepEqual(await upgradeWithPassword(V1_LONG, LONG, calls), { kind: "done" });
  assert.deepEqual(made, { upgrade: 1, reseal: 0 });
  assert.equal(store.current.version, 2);
  assert.equal(store.current.slots[0].kdf, "argon2id");
  assert.equal(text(await openSeed(store.current, LONG)), WORDS, "same password as before");
}

// ── a short password: upgraded, then a new one offered and chosen ───────────
{
  const store = account(V1_SHORT);
  const { calls, made } = callsFor(store);
  const step = await upgradeWithPassword(V1_SHORT, SHORT, calls);
  assert.equal(step.kind, "short");
  assert.deepEqual(made, { upgrade: 1, reseal: 0 }, "upgraded first, nothing re-sealed without asking");
  assert.deepEqual(step.vault, store.current, "the offer starts from what the account holds now");
  assert.equal(step.vault.version, 2);
  assert.equal(text(await openSeed(step.vault, SHORT)), WORDS, "skipping the offer still leaves it upgraded");

  const recovery = generateRecoveryKey();
  const NEW = "six generated words would go here";
  assert.equal(await chooseNewPassword(step.vault, { password: NEW, recoveryKey: recovery }, calls), "resealed");
  assert.deepEqual(made, { upgrade: 1, reseal: 1 });
  assert.equal(text(await openSeed(store.current, NEW)), WORDS);
  assert.equal(text(await openSeed(store.current, formatRecoveryKey(recovery))), WORDS, "and the recovery key");
  await assert.rejects(() => openSeed(store.current, SHORT), /Wrong password/, "the short one stops working");
}

// ── a wrong password writes nothing and offers nothing ──────────────────────
{
  const store = account(V1_LONG);
  const { calls, made } = callsFor(store);
  await assert.rejects(() => upgradeWithPassword(V1_LONG, "not it", calls), /Wrong password/);
  assert.deepEqual(made, { upgrade: 1, reseal: 0 });
  assert.equal(store.writes.length, 0);
}

// ── "Forgotten it?": a new password straight from this device's key ─────────
{
  const store = account(V1_SHORT);
  const { calls, made } = callsFor(store);
  assert.equal(await chooseNewPassword(V1_SHORT, { password: LONG }, calls), "resealed");
  assert.deepEqual(made, { upgrade: 0, reseal: 1 });
  assert.equal(store.current.version, 2, "and the backup moves to the new lock with it");
}

// ── another device got there first: nothing written, no offer ───────────────
{
  const store = account(V2);
  const { calls } = callsFor(store);
  assert.deepEqual(await upgradeWithPassword(V1_SHORT, SHORT, calls), { kind: "changed" });
  assert.equal(store.writes.length, 0);
}

// ── the component wires the real account calls ──────────────────────────────
{
  const prompt = readFileSync(new URL("../src/components/vaultUpgradePrompt.tsx", import.meta.url), "utf8");
  assert.match(prompt, /upgrade: upgradeAccountVault,/);
  assert.match(prompt, /reseal: resealCurrentIdentity,/);
  assert.match(prompt, /if \(!isSignedIn\) return;/, "a guest never reads an account");
  assert.match(prompt, /dismissUpgradePrompt\(grytUserId\)/);

  const key = readFileSync(new URL("../src/packages/common/src/auth/message-key.ts", import.meta.url), "utf8");
  assert.match(
    key,
    /upgradeAccountVault[\s\S]*?return upgradeSealedVault\(vault, secret, \{ read: readSealedVault, write: writeSealedVault \}\);/,
    "upgradeAccountVault goes through the same keep-the-old-one path as adopting",
  );
}

console.log("check-vault-upgrade-prompt: old format with the key only, not now sticks, short passwords get a new one offered");
