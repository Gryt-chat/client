/**
 * The vault's slow KDFs on web and Electron: Argon2id from hash-wasm, PBKDF2 from
 * WebCrypto. `check-identity-vault.mjs` holds both to the answers in `@gryt/crypto`.
 */
import type { VaultKdfs } from "@gryt/crypto/identity-vault";

export const webVaultKdfs: VaultKdfs = {
  async argon2id(password, salt, { m, t, p }) {
    // Loaded on first use, so the WASM stays out of startup.
    const { argon2id } = await import("hash-wasm");
    return argon2id({
      password,
      salt,
      iterations: t,
      memorySize: m,
      parallelism: p,
      hashLength: 32,
      outputType: "binary",
    });
  },

  async pbkdf2Sha256(password, salt, iterations) {
    const material = await crypto.subtle.importKey(
      "raw",
      password as Uint8Array<ArrayBuffer>,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: salt as Uint8Array<ArrayBuffer>, iterations, hash: "SHA-256" },
      material,
      256,
    );
    return new Uint8Array(bits);
  },
};
