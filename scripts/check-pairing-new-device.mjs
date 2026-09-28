/* eslint-env node */

// Linking from the new device's side (GRYT-1484): what gets written, in what order, and
// what doesn't when something fails. Core's two machines run against a relay in memory.

import assert from "node:assert/strict";

import { createApproverPairing, createNewDevicePairing } from "@gryt/core";
import { base64Url } from "@gryt/crypto";

import { ISSUER, memoryKeycloak, memoryRelay } from "./pairing-fakes.mjs";

const { createPairingOidc } = await import("../src/lib/pairing/oidc.ts");
const { describeThisDevice } = await import("../src/lib/pairing/device.ts");
const { createLinkStorage, mergePeerPins, lineageHints } = await import("../src/lib/pairing/install.ts");

// ── the install, recorded ────────────────────────────────────────────

function recordingDeps(existingPins = {}) {
  const log = [];
  let pins = existingPins;
  const deps = {
    installIdentity: async (seed, keys) => void log.push(["identity", seed.length, keys.length]),
    expectLineage: (host, origin) => void log.push(["lineage", host, origin]),
    pinStore: { read: () => pins, write: (next) => { pins = next; log.push(["pins", Object.keys(next).length]); } },
    markSeenOnMls: (scope, member) => void log.push(["seen", scope, member]),
    writeServers: async (servers, account) => void log.push(["servers", servers.length, account?.sub ?? null]),
    currentIssuer: () => ISSUER,
    useAuthServer: (issuer) => void log.push(["authServer", issuer]),
    adoptSession: async (tokens) => void log.push(["session", tokens.refreshToken]),
    rememberMessageKey: (sub) => void log.push(["messageKey", sub]),
    forgetMlsDevices: () => void log.push(["forgetMls"]),
  };
  return { deps, log, pins: () => pins };
}

const PIN = { thumbprint: "t", dmPublicKey: base64Url(new Uint8Array(32).fill(7)), firstSeenAt: 1, lastSeenAt: 2 };

function envelope(extra = {}) {
  return {
    seed: new Uint8Array(32).map((_, i) => i + 1),
    keys: [],
    servers: [
      { host: "chat.example", name: "Chat", scope: "srv:ORIGINKEY", scheme: "https" },
      { host: "lan.local:5003", name: "LAN", scope: "lan.local:5003" },
    ],
    pins: { "srv:ORIGINKEY": { "member-a": { ...PIN, seenOnMls: true }, "member-b": PIN } },
    from: "Sivert's laptop",
    ...extra,
  };
}

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

async function link({ env, keycloak = memoryKeycloak(), deps = recordingDeps(), added = [] }) {
  const relay = memoryRelay();
  const n = createNewDevicePairing({
    relay,
    device: describeThisDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0 Safari/537.36", true),
    storage: createLinkStorage(deps.deps),
    oidc: createPairingOidc(keycloak.fetch),
  });
  const a = createApproverPairing({
    relay,
    relayOrigin: "https://id.gryt.chat",
    fetch: keycloak.fetch,
    devices: (host) => ({ addOwnDevice: async (deviceId) => (added.push([host, deviceId]), []) }),
  });
  n.start();
  const showing = await waitFor(n, ["showing"]);
  assert.match(showing.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.match(showing.qr, /^GRYT:1:/);
  a.claim({ code: showing.code.toLowerCase() });
  const [nCompare, aConfirm] = await Promise.all([waitFor(n, ["comparing"]), waitFor(a, ["confirming"])]);
  assert.deepEqual(nCompare.emoji, aConfirm.emoji, "both sides show the same emoji");
  assert.deepEqual(aConfirm.device, { name: "Mac", app: "Gryt desktop", platform: "macOS" });
  a.approve(env, env.account ? async () => "fresh-token" : undefined);
  return { n, a, deps, keycloak };
}

// ── a guest ──────────────────────────────────────────────────────────

{
  const deps = recordingDeps({ "srv:ORIGINKEY member-b": { ...PIN, thumbprint: "mine" } });
  const added = [];
  const { n, a } = await link({ env: envelope(), deps, added });
  const joining = await waitFor(n, ["joining", "ended"]);
  assert.equal(joining.phase, "joining", `ended: ${joining.reason}`);
  assert.equal(joining.from, "Sivert's laptop");

  assert.deepEqual(deps.log, [
    ["forgetMls"],
    ["pins", 2],
    ["seen", "srv:ORIGINKEY", "member-a"],
    ["lineage", "chat.example", "ORIGINKEY"],
    ["identity", 32, 0],
    ["servers", 2, null],
  ]);
  assert.equal(deps.pins()["srv:ORIGINKEY member-b"].thumbprint, "mine", "a pin this device made is kept");
  assert.equal(deps.pins()["srv:ORIGINKEY member-a"].seenOnMls, undefined, "the flag goes to its own store");

  await n.ready([{ host: "chat.example", deviceId: "dev-n" }]);
  const done = await waitFor(a, ["done", "ended"]);
  assert.equal(done.phase, "done", `ended: ${done.reason}`);
  assert.deepEqual(added, [["chat.example", "dev-n"]]);
  await waitFor(n, ["done"]);
}

// ── an account ───────────────────────────────────────────────────────

const account = { issuer: ISSUER, clientId: "gryt-web", identityUrl: "https://id.example", sub: "user-1", username: "sivert@example.com" };
{
  const deps = recordingDeps();
  const keycloak = memoryKeycloak();
  const { n } = await link({ env: envelope({ account }), deps, keycloak });
  const joining = await waitFor(n, ["joining", "ended"]);
  assert.equal(joining.phase, "joining", `ended: ${joining.reason}`);
  assert.deepEqual(deps.log.slice(-4), [
    ["identity", 32, 0],
    ["servers", 2, "user-1"],
    ["session", "rt"],
    ["messageKey", "user-1"],
  ]);
  assert.ok(!deps.log.some(([k]) => k === "authServer"), "same auth server, nothing to switch");
  await n.cancel();
}

// A different Keycloak on the other device: this one follows it before signing in.
{
  const deps = recordingDeps();
  deps.deps.currentIssuer = () => "https://auth.gryt.chat/realms/gryt";
  const { n } = await link({ env: envelope({ account }), deps });
  await waitFor(n, ["joining"]);
  assert.deepEqual(deps.log.find(([k]) => k === "authServer"), ["authServer", ISSUER]);
  await n.cancel();
}

// Signed in as somebody else: nothing is written at all.
{
  const deps = recordingDeps();
  const { n } = await link({ env: envelope({ account }), deps, keycloak: memoryKeycloak({ sub: "someone-else" }) });
  const ended = await waitFor(n, ["ended", "joining"]);
  assert.equal(ended.phase, "ended");
  assert.equal(ended.reason, "wrong_account");
  assert.deepEqual(deps.log, [], "nothing kept");
}

// "They don't match" on the new device stops both sides before anything is sent.
{
  const relay = memoryRelay();
  const deps = recordingDeps();
  const n = createNewDevicePairing({ relay, device: { name: "x", app: "y", platform: "z" }, storage: createLinkStorage(deps.deps), oidc: createPairingOidc(async () => { throw new Error("unused"); }) });
  const a = createApproverPairing({ relay, relayOrigin: "https://id.gryt.chat", fetch: async () => { throw new Error("unused"); }, devices: () => undefined });
  n.start();
  const { code } = await waitFor(n, ["showing"]);
  a.claim({ code });
  await waitFor(n, ["comparing"]);
  await waitFor(a, ["confirming"]);
  await n.mismatch();
  assert.equal(n.state.reason, "mismatch");
  assert.equal((await waitFor(a, ["ended"])).phase, "ended");
  assert.deepEqual(deps.log, []);
}

// ── the wire formats ─────────────────────────────────────────────────

{
  const answers = [];
  const oidc = createPairingOidc(async () => answers.shift());
  const reply = (status, body) => ({ status, json: async () => body });
  const req = { issuer: ISSUER, clientId: "gryt-web", deviceCode: "d", codeVerifier: "v" };
  for (const [status, body, want] of [
    [400, { error: "authorization_pending" }, "pending"],
    [400, { error: "slow_down" }, "slow_down"],
    [400, { error: "expired_token" }, "expired"],
    [400, { error: "access_denied" }, "denied"],
    [503, null, "pending"],
    [200, { access_token: "a" }, "denied"],
  ]) {
    answers.push(reply(status, body));
    assert.equal((await oidc.deviceToken(req)).status, want, `${status} ${JSON.stringify(body)}`);
  }
  const dropped = createPairingOidc(async () => { throw new TypeError("Failed to fetch"); });
  assert.equal((await dropped.deviceToken(req)).status, "pending", "a dropped poll is tried again");

  answers.push(reply(401, { error: "unauthorized_client" }));
  await assert.rejects(
    oidc.deviceAuthorization({ issuer: ISSUER, clientId: "gryt-web", scope: "openid", codeChallenge: "c", codeChallengeMethod: "S256", nonce: "n" }),
    /unauthorized_client/,
  );
}

assert.deepEqual(describeThisDevice("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", false), {
  name: "Firefox",
  app: "Gryt in a browser",
  platform: "Linux",
});
assert.equal(describeThisDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Edg/140.0", false).name, "Edge");
assert.equal(describeThisDevice("Mozilla/5.0 (Windows NT 10.0) Electron/40.0", true).name, "Windows PC");

assert.deepEqual(lineageHints(envelope().servers), [{ host: "chat.example", originKeyId: "ORIGINKEY" }]);
assert.deepEqual(mergePeerPins({}, {}).pins, {});

console.log("pairing, new device: ok");
