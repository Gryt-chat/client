/* eslint-env node */

/**
 * Sealing the identity seed so it can follow somebody to a second device
 * (GRYT-783).
 *
 * This is the file that decides whether the stored ciphertext is worth
 * anything. The blob is meant to sit on a server, handed back after
 * authentication, so the interesting failures are the quiet ones: a wrong
 * secret that opens it anyway, a blob that can be opened as something it is
 * not, or a "seal" that returns the seed in a form somebody could read off the
 * wire.
 *
 * Run against the real module rather than a copy — Node strips the types on
 * import, which is why these live in .mjs and the source stays .ts.
 */

import assert from "node:assert/strict";

import {
  isSealedVault,
  openSeed,
  sealSeed,
  VAULT_TYPE,
} from "../src/packages/common/src/auth/identity-vault.ts";
import { lockBackup, unlockBackup } from "../src/packages/common/src/auth/identity-backup-lock.ts";

const SEED = new Uint8Array(32);
crypto.getRandomValues(SEED);
const SECRET = "correct horse battery staple";

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// ── it round-trips ──────────────────────────────────────────────────────────
{
  const sealed = await sealSeed(SEED, SECRET, "password");
  const opened = await openSeed(sealed, SECRET);
  assert.ok(same(opened, SEED), "the seed that comes back must be the seed that went in");
  assert.equal(sealed.secretKind, "password");
  assert.equal(sealed.type, VAULT_TYPE);
  assert.ok(isSealedVault(sealed));
}

// ── the seed is not sitting in the blob ─────────────────────────────────────
{
  // The failure this catches is a "seal" that encodes rather than encrypts.
  // Everything the server stores is checked, not just the ciphertext field.
  const sealed = await sealSeed(SEED, SECRET, "password");
  const hay = JSON.stringify(sealed);
  const asHex = [...SEED].map((b) => b.toString(16).padStart(2, "0")).join("");
  let asB64 = "";
  for (const b of SEED) asB64 += String.fromCharCode(b);
  const b64url = btoa(asB64).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.ok(!hay.includes(asHex), "the seed must not appear hex-encoded");
  assert.ok(!hay.includes(b64url), "the seed must not appear base64-encoded");
}

// ── a wrong secret does not open it ─────────────────────────────────────────
{
  const sealed = await sealSeed(SEED, SECRET, "password");
  for (const wrong of ["", "correct horse battery stapl", "Correct horse battery staple", " " + SECRET]) {
    await assert.rejects(() => openSeed(sealed, wrong), /Wrong secret|not a sealed/);
  }
}

// ── every stored field is authenticated ─────────────────────────────────────
{
  // AES-GCM covers the ciphertext, and the associated data covers the rest.
  // Without that a server holding the blob could change the iteration count or
  // the salt and see what happened.
  for (const field of ["data", "iv", "salt"]) {
    const sealed = await sealSeed(SEED, SECRET, "password");
    const bytes = [...atob(sealed[field].replace(/-/g, "+").replace(/_/g, "/"))].map((c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    let flipped = "";
    for (const b of bytes) flipped += String.fromCharCode(b);
    sealed[field] = btoa(flipped).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await assert.rejects(() => openSeed(sealed, SECRET), `flipping a bit in ${field} must be refused`);
  }
}

// ── a backup file cannot be opened as a vault, or the other way round ───────
{
  // Same shape, same algorithm, same passphrase. The only thing keeping them
  // apart is the associated data, so this is the test that proves it is doing
  // something.
  const sealed = await sealSeed(SEED, SECRET, "password");
  const asBackup = JSON.parse(await lockBackup(JSON.stringify({ hello: "world" }), SECRET));

  await assert.rejects(
    () => openSeed({ ...asBackup, type: VAULT_TYPE, secretKind: "password" }, SECRET),
    "a backup blob relabelled as a vault must not open",
  );
  await assert.rejects(
    () => unlockBackup(JSON.stringify({ ...sealed, type: "gryt-local-identity-backup-locked" }), SECRET),
    "a vault blob relabelled as a backup must not open",
  );
}

// ── two seals of the same seed differ ───────────────────────────────────────
{
  // A fixed salt or IV would make the stored blob a stable fingerprint of the
  // seed, so a server could tell that two accounts share one.
  const a = await sealSeed(SEED, SECRET, "password");
  const b = await sealSeed(SEED, SECRET, "password");
  assert.notEqual(a.salt, b.salt, "each seal needs its own salt");
  assert.notEqual(a.iv, b.iv, "each seal needs its own iv");
  assert.notEqual(a.data, b.data, "the same seed must not seal to the same bytes twice");
}

// ── the shape a caller has to cope with ─────────────────────────────────────
{
  await assert.rejects(() => sealSeed(SEED, "", "password"), /Choose a secret/);
  await assert.rejects(() => sealSeed(new Uint8Array(0), SECRET, "password"), /no seed/);
  for (const junk of [null, undefined, {}, { type: "something-else" }, "a string"]) {
    assert.equal(isSealedVault(junk), false);
    await assert.rejects(() => openSeed(junk, SECRET), /not a sealed/);
  }
  const sealed = await sealSeed(SEED, SECRET, "phrase");
  await assert.rejects(() => openSeed({ ...sealed, version: 99 }, SECRET), /newer version/);
}

console.log("check-identity-vault: ok");
