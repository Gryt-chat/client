/* eslint-env node */

// In-memory stand-ins for linking a device (GRYT-1484): the relay with auth#45's shapes and chunks,
// and Keycloak's device grant with auth#46's approve endpoint. Only what the apps touch.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import { PairingRelayError } from "@gryt/core";
import { base64Url, encodePairingSessionId, generatePairingCode } from "@gryt/crypto";

// ── a relay with auth#45's shapes, in memory ────────────────────────

export function memoryRelay() {
  const sessions = new Map();
  const byCode = new Map();
  const wake = (s) => { for (const w of s.waiters.splice(0)) w(); };
  const find = (id, token) => {
    const s = sessions.get(id);
    if (!s) throw new PairingRelayError(404, "unknown_session");
    if (s.closed) throw new PairingRelayError(410, "closed");
    const side = token === s.tokens.n ? "n" : token === s.tokens.a ? "a" : null;
    if (!side) throw new PairingRelayError(401, "bad_token");
    return { s, side };
  };
  const push = (s, from, message) => {
    s.sent[from].push({ seq: ++s.seq[from], ...message });
    wake(s);
  };
  return {
    async create(commit) {
      const id = encodePairingSessionId(randomBytes(16));
      const code = generatePairingCode();
      const s = { id, commit, tokens: { n: base64Url(randomBytes(16)), a: null }, sent: { n: [], a: [] }, seq: { n: 0, a: 0 }, waiters: [], closed: false };
      sessions.set(id, s);
      byCode.set(code, s);
      return { id, code, token: s.tokens.n, expiresAt: new Date(Date.now() + 300_000).toISOString() };
    },
    async claim(by, pkA) {
      const s = "code" in by ? byCode.get(by.code) : sessions.get(by.id);
      if (!s) throw new PairingRelayError(404, "unknown_code");
      if (s.tokens.a) throw new PairingRelayError(409, "already_claimed");
      s.tokens.a = base64Url(randomBytes(16));
      push(s, "a", { type: "claim", pkA });
      return { id: s.id, token: s.tokens.a, commit: s.commit, location: "Oslo, Norway", yourLocation: "Oslo, Norway" };
    },
    async post(id, token, message) {
      const { s, side } = find(id, token);
      push(s, side, message);
    },
    async poll(id, token, after, waitSeconds, signal) {
      // Like fetch: an aborted poll throws rather than coming back empty.
      signal?.throwIfAborted();
      const { s, side } = find(id, token);
      const other = side === "n" ? "a" : "n";
      const ready = () => s.sent[other].filter((m) => m.seq > after);
      if (!ready().length && !s.closed) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, Math.min(waitSeconds, 1) * 1000);
          s.waiters.push(() => (clearTimeout(timer), resolve()));
          signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
        });
      }
      signal?.throwIfAborted();
      if (s.closed) throw new PairingRelayError(410, "closed");
      return ready();
    },
    async close(id, token) {
      const { s } = find(id, token);
      s.closed = true;
      wake(s);
    },
    async putChunk(id, token, n, sealed) {
      const { s, side } = find(id, token);
      assert.equal(side, "a", "only the approving side uploads history");
      (s.chunks ??= new Map()).set(n, new Uint8Array(sealed));
    },
    async getChunk(id, token, n) {
      const { s } = find(id, token);
      const chunk = s.chunks?.get(n);
      if (!chunk) throw new PairingRelayError(404, "unknown_chunk");
      return chunk;
    },
    async deleteChunk(id, token, n) {
      find(id, token).s.chunks?.delete(n);
    },
  };
}

// ── Keycloak's device grant and the approve extension, in memory ────

export const ISSUER = "https://auth.example/realms/gryt";
const b64json = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");

export function memoryKeycloak({ sub = "user-1", extension = true } = {}) {
  const codes = new Map();
  const reply = (status, body) => ({ status, json: async () => body });
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    const form = new URLSearchParams(init.body ?? "");
    if (url === `${ISSUER}/protocol/openid-connect/auth/device`) {
      assert.equal(form.get("client_id"), "gryt-web");
      assert.equal(form.get("code_challenge_method"), "S256");
      assert.match(form.get("scope"), /offline_access/);
      const userCode = `UC${codes.size}`;
      codes.set(userCode, { deviceCode: `dc-${userCode}`, nonce: form.get("nonce"), approved: false });
      return reply(200, { device_code: `dc-${userCode}`, user_code: userCode, expires_in: 300, interval: 0.01 });
    }
    if (url === `${ISSUER}/protocol/openid-connect/token`) {
      const code = [...codes.values()].find((c) => c.deviceCode === form.get("device_code"));
      assert.ok(form.get("code_verifier"), "the verifier goes with every poll");
      if (!code?.approved) return reply(400, { error: "authorization_pending" });
      const idToken = `x.${b64json({ iss: ISSUER, aud: "gryt-web", sub, nonce: code.nonce })}.x`;
      return reply(200, { id_token: idToken, access_token: "at", refresh_token: "rt", expires_in: 300 });
    }
    if (url === `${ISSUER}/gryt-pairing/approve`) {
      if (!extension) return reply(404, null);
      const body = JSON.parse(init.body);
      const code = codes.get(body.user_code);
      if (!code || code.nonce !== body.binding) return reply(403, { error: "binding_mismatch" });
      assert.equal(init.headers.authorization, "Bearer fresh-token");
      code.approved = true;
      return reply(204, null);
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  /** What Keycloak's own device page does when somebody chooses Yes there. */
  const approveInBrowser = (userCode) => void (codes.get(userCode).approved = true);
  return { fetch, calls, approveInBrowser };
}
