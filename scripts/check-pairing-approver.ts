/* eslint-env node */

// Linking from the approving device's side (GRYT-1484): what goes in the envelope, that the
// access token is fetched only once the new device's code is in, and the adds after "ready".

import assert from "node:assert/strict";

import { createApproverPairing, createNewDevicePairing, type PairingRelay } from "@gryt/core";
import { asIdentityScope, base64Url, encodePairingEnvelope } from "@gryt/crypto";

import { ISSUER, type KeycloakReply, memoryKeycloak, memoryRelay, waitFor } from "./pairing-fakes.ts";

const { accountFromToken, buildEnvelope } = await import("../src/lib/pairing/envelope.ts");
const { fromHistoryRecord, toHistoryRecord } = await import("../src/lib/pairing/historyRecords.ts");
const { historyArchive } = await import("../src/lib/pairing/historyArchive.ts");
const { approverEndText, sendingHistoryText, sentHistoryText } = await import("../src/lib/pairing/approverWords.ts");
const { deviceCapLine, serversAtDeviceCap } = await import("../src/lib/pairing/deviceCap.ts");

// ── the envelope ─────────────────────────────────────────────────────

const PIN = { thumbprint: "t", dmPublicKey: base64Url(new Uint8Array(32).fill(7)), firstSeenAt: 1, lastSeenAt: 2 };
const seed = new Uint8Array(32).map((_, i) => i + 1);

const envelope = buildEnvelope({
  seed,
  keys: [],
  servers: [
    { host: "chat.example", name: "Chat", scope: asIdentityScope("srv:ORIGIN"), scheme: "https" },
    { host: "lan.local:5003", name: "LAN", scope: asIdentityScope("lan.local:5003"), scheme: null },
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
assert.equal(accountFromToken({ iss: ISSUER, sub: "u1", email: "e@example.com" }, config)?.username, "e@example.com");
assert.equal(accountFromToken({ iss: ISSUER, preferred_username: "x" }, config), null, "no sub, no account");
assert.equal(accountFromToken(undefined, config), null);

// ── both sides, through a relay in memory ───────────────────────────


/** The new device's side, as small as core allows: Keycloak straight through `fetch`. */
type NewDeviceOptions = Parameters<typeof createNewDevicePairing>[0];

function newDevice(relay: PairingRelay, keycloak: ReturnType<typeof memoryKeycloak>, sink: NewDeviceOptions["history"]) {
  const post = async (path: string, form: Record<string, string>) => {
    const res = await keycloak.fetch(`${ISSUER}/protocol/openid-connect/${path}`, { body: new URLSearchParams(form).toString() });
    // What Keycloak answers these two calls with; a pending poll leaves the token fields out.
    return { status: res.status, json: (await res.json()) as Required<KeycloakReply> };
  };
  const committed: { e: Parameters<NewDeviceOptions["storage"]["commit"]>[0]; tokens: Parameters<NewDeviceOptions["storage"]["commit"]>[1] }[] = [];
  return {
    committed,
    machine: createNewDevicePairing({
      relay,
      device: { name: "Pixel", app: "Gryt for Android", platform: "Android" },
      history: sink,
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

type ApproverOptions = Parameters<typeof createApproverPairing>[0];
type Approve = Parameters<ReturnType<typeof createApproverPairing>["approve"]>;
type ApproveOne = {
  env: Approve[0];
  keycloak?: ReturnType<typeof memoryKeycloak>;
  accessToken?: Approve[1];
  added?: string[];
  progress?: string[];
  history?: ApproverOptions["history"];
  sink?: NewDeviceOptions["history"];
};

async function approveOne({ env, keycloak = memoryKeycloak(), accessToken, added = [], progress = [], history, sink }: ApproveOne) {
  const relay = memoryRelay();
  const n = newDevice(relay, keycloak, sink);
  const a = createApproverPairing({
    relay,
    relayOrigin: "https://id.gryt.chat",
    fetch: keycloak.fetch,
    history,
    lateWindowMs: 10,
    devices: (host: string) =>
      host === "chat.example"
        ? {
            async addOwnDevice(deviceId, options) {
              added.push(deviceId);
              const results = ["dm-1", "dm-2"].map((conversationId, i) => ({
                conversationId,
                groupId: `g${i}`,
                outcome: i === 0 ? ("added" as const) : ("failed" as const),
                add: null,
              }));
              results.forEach((result, i) => options?.onProgress?.({ done: i + 1, total: 2, result }));
              return results;
            },
            groupPositions: async () => [],
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
  const added: string[] = [];
  const progress: string[] = [];
  const { a, n, keycloak } = await approveOne({ env: envelope, added, progress });
  await waitFor(n.machine, ["joining"]);
  assert.equal(n.committed[0].tokens, null);
  assert.deepEqual(n.committed[0].e.servers.map((s) => s.host), ["chat.example", "lan.local:5003"]);
  await n.machine.ready([{ host: "chat.example", deviceId: "dev-new" }, { host: "gone.example", deviceId: "x" }]);
  const done = await waitFor(a, ["done", "ended"]);
  assert.equal(done.phase, "done", `ended: ${JSON.stringify(done)}`);
  assert.deepEqual(added, ["dev-new"], "only a server this device has a session on");
  assert.deepEqual(progress, ["1/2", "2/2"]);
  assert.equal(done.added["chat.example"].filter((r) => r.outcome === "failed").length, 1);
  assert.ok(!keycloak.calls.some((u) => u.includes("gryt-pairing")), "a guest never calls the extension");
}

const account = { issuer: ISSUER, clientId: "gryt-web", identityUrl: "https://id.example", sub: "user-1", username: "sivert@example.com" };

// An account: the token is asked for once, after the new device's code has arrived.
{
  const order: string[] = [];
  const keycloak = memoryKeycloak();
  const fetch = keycloak.fetch;
  keycloak.fetch = async (url: string, init: Parameters<typeof fetch>[1]) => (order.push(url.split("/").pop() ?? ""), fetch(url, init));
  const { a, n } = await approveOne({
    env: { ...envelope, account },
    keycloak,
    accessToken: async () => (order.push("access"), "fresh-token"),
  });
  await waitFor(n.machine, ["joining"]);
  assert.equal(n.committed[0].tokens?.refreshToken, "rt");
  assert.deepEqual(order.filter((x) => x === "device" || x === "access" || x === "approve"), ["device", "access", "approve"]);
  await n.machine.cancel();
  assert.equal((await waitFor(a, ["ended", "done"])).phase, "ended");
}

// No extension on this Keycloak: the device page, for the same code, and it carries on from there.
{
  const keycloak = memoryKeycloak({ extension: false });
  const { a, n } = await approveOne({ env: { ...envelope, account }, keycloak, accessToken: async () => "fresh-token" });
  const browser = await waitFor(a, ["browser", "ended"]);
  assert.equal(browser.phase, "browser", `ended: ${JSON.stringify(browser)}`);
  assert.equal(browser.url, `${ISSUER}/device?user_code=UC0`);
  keycloak.approveInBrowser("UC0");
  await waitFor(n.machine, ["joining"]);
  await n.machine.cancel();
}

// ── history: this archive's records, across and back into an archive ──

const record = (i: number, extra: object = {}) => ({
  scope: "srv:ORIGIN",
  conversationId: `dm-${i % 3}`,
  messageId: `m${i}`,
  sentAt: 1_700_000_000_000 + i * 60_000,
  senderId: i % 2 ? "me" : "them",
  text: `message ${i}`,
  attachments: {},
  ...extra,
});

{
  const full = record(1, {
    senderDeviceId: "dev-1",
    editedAt: 5,
    replyTo: "m0",
    reactions: [{ src: "👍", amount: 1, users: ["them"] }],
    attachments: { f1: { id: "a1", key: "k", nonce: "n", mime: "image/png", size: 3 } },
  });
  assert.deepEqual(fromHistoryRecord(toHistoryRecord(full)), full, "a record survives the trip whole");
  // A record carries its message untyped; this one is ours.
  assert.equal((toHistoryRecord(record(2)).message as { reactions?: object }).reactions, undefined, "nothing unset goes across");
  assert.equal(fromHistoryRecord({ ...toHistoryRecord(record(2)), message: "x" }), null);
  assert.equal(fromHistoryRecord({ ...toHistoryRecord(record(2)), message: { text: "no sender", attachments: {} } }), null);
  const messy = fromHistoryRecord({
    ...toHistoryRecord(record(3)),
    message: { senderId: "me", text: "t", attachments: { ok: { id: "a", key: "k" }, bad: 7 }, editedAt: "soon", reactions: [{ src: 1 }] },
  });
  assert.ok(messy, "a messy record was dropped whole");
  assert.deepEqual(Object.keys(messy.attachments), ["ok"], "a broken attachment is dropped, not the message");
  assert.equal(messy.editedAt, undefined);
  assert.equal(messy.reactions, undefined);
}

/** MessageArchive's page and conversations, over an array. */
function arrayArchive(rows: ReturnType<typeof record>[]) {
  return {
    async conversations() {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const k = JSON.stringify([r.scope, r.conversationId]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return [...counts].map(([k, count]) => {
        const [scope, conversationId] = JSON.parse(k);
        return { scope, conversationId, count };
      });
    },
    async page(scope: string, conversationId: string, { before, limit }: { before?: ReturnType<typeof record>; limit: number }) {
      const older = (r: ReturnType<typeof record>) => !before || r.sentAt < before.sentAt || (r.sentAt === before.sentAt && r.messageId < before.messageId);
      return rows
        .filter((r) => r.scope === scope && r.conversationId === conversationId && older(r))
        .sort((x, y) => x.sentAt - y.sentAt)
        .slice(-limit);
    },
  };
}

// A guest with 250 messages in three DMs: every one lands in the new device's archive once.
{
  const rows = Array.from({ length: 250 }, (_, i) => record(i));
  const stored = new Map();
  const sink = { put: async (records: Parameters<typeof fromHistoryRecord>[0][]) => records.map(fromHistoryRecord).forEach((m) => {
    assert.ok(m, "a record from the other side would not open");
    stored.set(m.messageId, m);
  }) };
  const sent: string[] = [];
  const { a, n } = await approveOne({ env: envelope, history: historyArchive(arrayArchive(rows)), sink });
  a.subscribe((s) => void (s.phase === "sending" && sent.push(sendingHistoryText(a.history))));
  await waitFor(n.machine, ["joining"]);
  await n.machine.ready([{ host: "chat.example", deviceId: "dev-new" }]);
  assert.equal((await waitFor(a, ["done", "ended"])).phase, "done");
  assert.equal((await waitFor(n.machine, ["done", "ended"])).phase, "done");
  assert.equal(stored.size, 250);
  assert.deepEqual(stored.get("m7"), rows[7]);
  assert.equal(sentHistoryText(a.history), "250 messages of history came across.");
  assert.ok(sent.length > 0 && sent[0].startsWith("Sending your message history"));
}

// ── what the approving side says ─────────────────────────────────────

for (const reason of ["code_used", "code_expired", "required_actions", "stale_token", "access_denied", "expired_token", "rate_limited"] as const) {
  assert.notEqual(approverEndText(reason), "Linking stopped before it finished.", `${reason} has its own line`);
}
assert.equal(
  approverEndText("approve:weird_thing"),
  "The sign-in service turned this down (weird_thing). Start again from the new device.",
);
assert.equal(sendingHistoryText(null), "Sending your message history…");
/** A history count with only the fields the words read set. */
const counted = (p: { messages: number; total?: number | null }) => ({
  total: null, chunks: 0, listed: 0, missing: 0, refused: 0, truncated: false, oldest: null, complete: false, ...p,
});
assert.equal(sendingHistoryText(counted({ messages: 12, total: null })), "Sending your message history: 12 so far");
assert.equal(sendingHistoryText(counted({ messages: 12, total: 10 })), "Sending your message history: 10 of 10");
assert.equal(sentHistoryText(counted({ messages: 0 })), null);
assert.equal(sentHistoryText(counted({ messages: 1 })), "1 message of history came across.");

// ── a sixth device ───────────────────────────────────────────────────

assert.deepEqual(
  serversAtDeviceCap([
    { host: "a", deviceCount: 5 },
    { host: "b", deviceCount: 4 },
    { host: "c", deviceCount: null },
    { host: "d", deviceCount: 6 },
  ]).map((s) => s.host),
  ["a", "d"],
  "full at five, and a server whose count isn't known isn't named",
);
assert.equal(deviceCapLine("Chat"), "Chat already has 5 of your devices, so the new one won't get your DMs there. Remove one first.");

console.log("pairing, approving device: ok");
