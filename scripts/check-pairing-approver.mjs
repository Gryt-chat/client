/* eslint-env node */

// Linking from the approving device's side (GRYT-1484): what goes in the envelope, that the
// access token is fetched only once the new device's code is in, and the adds after "ready".

import assert from "node:assert/strict";

import { createApproverPairing, createNewDevicePairing } from "@gryt/core";
import { base64Url, encodePairingEnvelope } from "@gryt/crypto";

import { ISSUER, memoryKeycloak, memoryRelay } from "./pairing-fakes.mjs";

const { accountFromToken, buildEnvelope } = await import("../src/lib/pairing/envelope.ts");

// ── the envelope ─────────────────────────────────────────────────────

const PIN = { thumbprint: "t", dmPublicKey: base64Url(new Uint8Array(32).fill(7)), firstSeenAt: 1, lastSeenAt: 2 };
const seed = new Uint8Array(32).map((_, i) => i + 1);

const envelope = buildEnvelope({
  seed,
  keys: [],
  servers: [
    { host: "chat.example", name: "Chat", scope: "srv:ORIGIN", scheme: "https" },
    { host: "lan.local:5003", name: "LAN", scope: "lan.local:5003", scheme: null },
  ],
  pins: {
    "srv:ORIGIN member-a": PIN,
    "srv:ORIGIN member-b": PIN,
    "srv:ELSEWHERE member-c": PIN,
    broken: PIN,
  },
  seenOnMls: (scope, member) => scope === "srv:ORIGIN" && member === "member-a",
  from: "Mac",
});

assert.deepEqual(envelope.servers, [
  { host: "chat.example", name: "Chat", scope: "srv:ORIGIN", scheme: "https" },
  { host: "lan.local:5003", name: "LAN", scope: "lan.local:5003" },
]);
assert.deepEqual(Object.keys(envelope.pins), ["srv:ORIGIN"], "pins only for the servers handed over");
assert.equal(envelope.pins["srv:ORIGIN"]["member-a"].seenOnMls, true);
assert.equal(envelope.pins["srv:ORIGIN"]["member-b"].seenOnMls, undefined);
assert.equal(envelope.account, undefined, "a guest sends no account");
assert.ok(encodePairingEnvelope(envelope).length > 0, "crypto's encoder takes it");

const config = { clientId: "gryt-web", identityUrl: "https://id.example" };
assert.deepEqual(accountFromToken({ iss: ISSUER, sub: "u1", preferred_username: "sivert@example.com" }, config), {
  issuer: ISSUER,
  clientId: "gryt-web",
  identityUrl: "https://id.example",
  sub: "u1",
  username: "sivert@example.com",
});
assert.equal(accountFromToken({ iss: ISSUER, sub: "u1", email: "e@example.com" }, config).username, "e@example.com");
assert.equal(accountFromToken({ iss: ISSUER, preferred_username: "x" }, config), null, "no sub, no account");
assert.equal(accountFromToken(undefined, config), null);

// ── both sides, through a relay in memory ───────────────────────────

const waitFor = (machine, phases, ms = 10_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Stuck in ${machine.state.phase}, wanted ${phases}`)), ms);
    const check = (s) => {
      if (!phases.includes(s.phase)) return false;
      clearTimeout(timer);
      unsubscribe();
      resolve(s);
      return true;
    };
    const unsubscribe = machine.subscribe(check);
    check(machine.state);
  });

/** The new device's side, as small as core allows: Keycloak straight through `fetch`. */
function newDevice(relay, keycloak) {
  const post = async (path, form) => {
    const res = await keycloak.fetch(`${ISSUER}/protocol/openid-connect/${path}`, { method: "POST", body: new URLSearchParams(form).toString() });
    return { status: res.status, json: await res.json() };
  };
  const committed = [];
  return {
    committed,
    machine: createNewDevicePairing({
      relay,
      device: { name: "Pixel", app: "Gryt for Android", platform: "Android" },
      storage: { commit: async (e, tokens) => void committed.push({ e, tokens }) },
      oidc: {
        async deviceAuthorization(r) {
          const { json } = await post("auth/device", { client_id: r.clientId, scope: r.scope, code_challenge: r.codeChallenge, code_challenge_method: r.codeChallengeMethod, nonce: r.nonce });
          return { deviceCode: json.device_code, userCode: json.user_code, expiresIn: json.expires_in, interval: json.interval };
        },
        async deviceToken(r) {
          const { status, json } = await post("token", { client_id: r.clientId, device_code: r.deviceCode, code_verifier: r.codeVerifier });
          if (status !== 200) return { status: "pending" };
          return { status: "ok", tokens: { idToken: json.id_token, accessToken: json.access_token, refreshToken: json.refresh_token } };
        },
      },
    }),
  };
}

async function approveOne({ env, keycloak = memoryKeycloak(), accessToken, added = [], progress = [] }) {
  const relay = memoryRelay();
  const n = newDevice(relay, keycloak);
  const a = createApproverPairing({
    relay,
    relayOrigin: "https://id.gryt.chat",
    fetch: keycloak.fetch,
    devices: (host) =>
      host === "chat.example"
        ? {
            async addOwnDevice(deviceId, options) {
              added.push(deviceId);
              const results = ["dm-1", "dm-2"].map((conversationId, i) => ({
                conversationId,
                groupId: `g${i}`,
                outcome: i === 0 ? "added" : "failed",
                add: null,
              }));
              results.forEach((result, i) => options?.onProgress?.({ done: i + 1, total: 2, result }));
              return results;
            },
          }
        : undefined,
  });
  a.subscribe((s) => {
    if (s.phase === "adding") progress.push(`${s.done}/${s.total}`);
  });
  n.machine.start();
  const { code } = await waitFor(n.machine, ["showing"]);
  a.claim({ code });
  const confirming = await waitFor(a, ["confirming"]);
  assert.deepEqual(confirming.device, { name: "Pixel", app: "Gryt for Android", platform: "Android" });
  assert.equal(confirming.location, "Oslo, Norway");
  a.approve(env, accessToken);
  return { a, n, keycloak };
}

// A guest: no Keycloak at all, and the adds go where "ready" says.
{
  const added = [];
  const progress = [];
  const { a, n, keycloak } = await approveOne({ env: envelope, added, progress });
  await waitFor(n.machine, ["joining"]);
  assert.equal(n.committed[0].tokens, null);
  assert.deepEqual(n.committed[0].e.servers.map((s) => s.host), ["chat.example", "lan.local:5003"]);
  await n.machine.ready([{ host: "chat.example", deviceId: "dev-new" }, { host: "gone.example", deviceId: "x" }]);
  const done = await waitFor(a, ["done", "ended"]);
  assert.equal(done.phase, "done", `ended: ${done.reason}`);
  assert.deepEqual(added, ["dev-new"], "only a server this device has a session on");
  assert.deepEqual(progress, ["1/2", "2/2"]);
  assert.equal(done.added["chat.example"].filter((r) => r.outcome === "failed").length, 1);
  assert.ok(!keycloak.calls.some((u) => u.includes("gryt-pairing")), "a guest never calls the extension");
}

const account = { issuer: ISSUER, clientId: "gryt-web", identityUrl: "https://id.example", sub: "user-1", username: "sivert@example.com" };

// An account: the token is asked for once, after the new device's code has arrived.
{
  const order = [];
  const keycloak = memoryKeycloak();
  const fetch = keycloak.fetch;
  keycloak.fetch = async (url, init) => (order.push(url.split("/").pop()), fetch(url, init));
  const { a, n } = await approveOne({
    env: { ...envelope, account },
    keycloak,
    accessToken: async () => (order.push("access"), "fresh-token"),
  });
  await waitFor(n.machine, ["joining"]);
  assert.equal(n.committed[0].tokens.refreshToken, "rt");
  assert.deepEqual(order.filter((x) => x === "device" || x === "access" || x === "approve"), ["device", "access", "approve"]);
  await n.machine.cancel();
  assert.equal((await waitFor(a, ["ended", "done"])).phase, "ended");
}

// No extension on this Keycloak: the device page, for the same code, and it carries on from there.
{
  const keycloak = memoryKeycloak({ extension: false });
  const { a, n } = await approveOne({ env: { ...envelope, account }, keycloak, accessToken: async () => "fresh-token" });
  const browser = await waitFor(a, ["browser", "ended"]);
  assert.equal(browser.phase, "browser", `ended: ${browser.reason}`);
  assert.equal(browser.url, `${ISSUER}/device?user_code=UC0`);
  keycloak.approveInBrowser("UC0");
  await waitFor(n.machine, ["joining"]);
  await n.machine.cancel();
}

console.log("pairing, approving device: ok");
