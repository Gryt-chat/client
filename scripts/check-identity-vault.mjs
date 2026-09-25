/* eslint-env node */

/**
 * The sealed seed on web and Electron: `@gryt/crypto`'s format over hash-wasm and
 * WebCrypto. Two KDF implementations are only safe while this proves they agree (GRYT-1473).
 */

import assert from "node:assert/strict";

import { referenceVaultKdfs } from "@gryt/crypto/identity-vault";

import { lockBackup, unlockBackup } from "../src/packages/common/src/auth/identity-backup-lock.ts";
import {
  isSealedVault,
  openSeed,
  sealSeed,
  VAULT_TYPE,
} from "../src/packages/common/src/auth/identity-vault.ts";
import { webVaultKdfs } from "../src/packages/common/src/auth/vault-kdfs.ts";

const hex = (bytes) => Buffer.from(bytes).toString("hex");
const utf8 = (text) => new TextEncoder().encode(text);
const text = (bytes) => new TextDecoder().decode(bytes);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const WORDS =
  "abandon amount liar amount expire adjust cage candy arch gather drum bullet " +
  "absurd math era live bid rhythm alien crouch range attend journey unaware";

// ── hash-wasm gives the published answers, and @gryt/crypto's ───────────────
{
  // phc-winner-argon2's test.c. RFC 9106's vector needs associated data hash-wasm lacks.
  const phc = await webVaultKdfs.argon2id(utf8("password"), utf8("somesalt"), { t: 2, m: 65536, p: 1 });
  assert.equal(hex(phc), "09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7");

  // The vault's own parameters: the same literal @gryt/crypto holds its reference to.
  const ours = await webVaultKdfs.argon2id(
    utf8("vector password"), Uint8Array.from({ length: 16 }, (_, i) => i), { m: 65536, t: 3, p: 1 },
  );
  assert.equal(hex(ours), "24a8ca3ac31cdb6d9ed4072aeb77d85fcb5b716e3132477dbdf8680ef3060a6d");

  const salt = utf8("sixteen byte slt");
  for (const pw of ["", "hunter2x", "Blåbær"]) {
    assert.deepEqual(
      await webVaultKdfs.pbkdf2Sha256(utf8(pw), salt, 1000),
      await referenceVaultKdfs.pbkdf2Sha256(utf8(pw), salt, 1000),
      "WebCrypto's PBKDF2 and noble's disagree",
    );
  }
}

// ── bundles sealed before this change still open here ───────────────────────
{
  // Sealed by identity-vault.ts at b215c594, the last version 1 client.
  const v1 = {"type":"gryt-identity-vault","version":1,"kdf":"PBKDF2-SHA256","iterations":600000,"secretKind":"password","salt":"ya-E99aPOrPB9cVWHRAN0A","iv":"LpB5rtziarP9gIDY","data":"H-1uwG7cQpsTN4M1SX7HZnL8iuXix7CDLdSo5Mq2pdRdIl0elisAc6SEIkXCwQveDe6bi05vufkt18jDz61oW3CedQ9oIaYBa2qGb3UMa5523pxrXRNMoWPduZyL8Z6o7zLkIkTagj6UIZJ6_XCw8CQJRsp5flXRP2MRwa1u-nIsyrjysMWdoiwug6aVSh7B1RbaG3wXFNxT-dLT7WIIlfjSO2Fx"};
  assert.equal(text(await openSeed(v1, "hunter2x")), WORDS);
  await assert.rejects(() => openSeed(v1, "hunter2X"), /Wrong password/);

  // Sealed by @gryt/crypto's reference build, opened by hash-wasm.
  const v2 = {"type":"gryt-identity-vault","version":2,"secretKind":"password","salt":"","iv":"nqcvsvYf8MrRqcKe","data":"koQ68z2tN96rbIckVaDaYznXFZrWZ2_EHncb9sPqFCK-RSo9XHnKZjvKO0OTMQKgEqM8MATlAICv2WyZixcPk0h7mzdfHSkPk_tZitn4OGIWwR4IdyZrGKI-8WmytUXSxqCswnvmuL2Akafxdqlo-ALaouM7p7NdXXunmYpLxw7zgV2oRUJ9js9dotA1MJjkH-Dg74-xWjAf1VDLC51NeX7uZQee","slots":[{"kind":"password","kdf":"argon2id","m":65536,"t":3,"p":1,"salt":"zrinFrrnINf3_98bbE3L2Q","iv":"rHX5v0kTPDiYiz3s","key":"FSAg_cXJPP-hP3UoZ-YFoeAS7MrYLSrGuvqmHAjxUdzuw1OECHoofjTPnZdeFlCk"},{"kind":"recovery","kdf":"hkdf-sha256","salt":"e4GrFtB6ph7lgB9adk-iEg","iv":"Vo9hwBqLal_T7ZAe","key":"6nG42JskyoM0NZs0BtWctkHmJJPKNVqT2Jh9AC5uQVpKDVnHerVTJQfFxzAFtVdk"}]};
  assert.equal(text(await openSeed(v2, "legal winner thank year wave sausage")), WORDS);
  assert.equal(text(await openSeed(v2, "0440-Y5GX-4GNK-4EA0-8X75-AQ33-D9RQ-GZW6-HPA9-Q8N9-P2VV-XHEC-TFD0")), WORDS);
}

const SEED = new Uint8Array(32);
crypto.getRandomValues(SEED);
const SECRET = "correct horse battery staple";

// ── it round-trips, and the reference build opens what this one seals ──────
{
  const sealed = await sealSeed(SEED, { password: SECRET });
  assert.ok(same(await openSeed(sealed, SECRET), SEED));
  assert.equal(sealed.version, 2);
  assert.equal(sealed.type, VAULT_TYPE);
  assert.ok(isSealedVault(sealed));

  const { openSeed: openReference } = await import("@gryt/crypto/identity-vault");
  assert.ok(same(await openReference(sealed, SECRET), SEED), "the phone's build would not open this");
}

// ── the seed is not sitting in the blob ─────────────────────────────────────
{
  // The failure this catches is a "seal" that encodes rather than encrypts.
  const hay = JSON.stringify(await sealSeed(SEED, { password: SECRET }));
  assert.ok(!hay.includes(hex(SEED)), "the seed must not appear hex-encoded");
  assert.ok(!hay.includes(Buffer.from(SEED).toString("base64url")), "the seed must not appear base64-encoded");
}

// ── a wrong secret does not open it ─────────────────────────────────────────
{
  const sealed = await sealSeed(SEED, { password: SECRET });
  for (const wrong of ["", "correct horse battery stapl", "Correct horse battery staple", " " + SECRET]) {
    await assert.rejects(() => openSeed(sealed, wrong), /Wrong password/);
  }
}

// ── a backup file cannot be opened as a vault, or the other way round ───────
{
  // Same algorithm and passphrase. Only the associated data keeps them apart.
  const asBackup = JSON.parse(await lockBackup(JSON.stringify({ hello: "world" }), SECRET));
  await assert.rejects(
    () => openSeed({ ...asBackup, type: VAULT_TYPE, secretKind: "password" }, SECRET),
    "a backup blob relabelled as a vault must not open",
  );
  const sealed = await sealSeed(SEED, { password: SECRET });
  await assert.rejects(
    () => unlockBackup(JSON.stringify({ ...sealed, type: "gryt-local-identity-backup-locked" }), SECRET),
    "a vault blob relabelled as a backup must not open",
  );
}

// ── two seals of the same seed differ ───────────────────────────────────────
{
  // A fixed salt or IV would make the stored blob a stable fingerprint of the seed.
  const a = await sealSeed(SEED, { password: SECRET });
  const b = await sealSeed(SEED, { password: SECRET });
  assert.notEqual(a.slots[0].salt, b.slots[0].salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
}

// ── the shape a caller has to cope with ─────────────────────────────────────
{
  await assert.rejects(() => sealSeed(SEED, { password: "" }), /Choose a password/);
  await assert.rejects(() => sealSeed(new Uint8Array(0), { password: SECRET }), /no seed/);
  for (const junk of [null, undefined, {}, { type: "something-else" }, "a string"]) {
    assert.equal(isSealedVault(junk), false);
    await assert.rejects(() => openSeed(junk, SECRET), /not a sealed/);
  }
  const sealed = await sealSeed(SEED, { password: SECRET });
  await assert.rejects(() => openSeed({ ...sealed, version: 99 }, SECRET), /newer version/);
}

console.log("check-identity-vault: ok");
