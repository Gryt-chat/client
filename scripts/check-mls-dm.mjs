/* eslint-env node */

// The pure parts of MLS DMs: the timeline merge, the notices, the archive writes, the
// socket transport and the person key publish. The phone runs the same cases (GRYT-1513).

import assert from "node:assert/strict";

const { archivedRow, dmComposer, isMlsPlaceholder, mergeTimeline, mlsNotice, newMessage, sendFailure, withOpenedFiles } =
  await import("../src/packages/socket/src/mls/timeline.ts");
const { createModeOnlySource } = await import("../src/packages/socket/src/mls/modeOnly.ts");
const { applyMlsContent } = await import("../src/packages/socket/src/mls/applyContent.ts");
const { asBytes, socketMlsTransport } = await import("../src/packages/socket/src/mls/transport.ts");
const { publishPersonKey } = await import("../src/packages/socket/src/mls/publishPersonKey.ts");
const { readMlsCapability } = await import("../src/packages/socket/src/mls/capability.ts");
const { seenOnMlsFor } = await import("../src/packages/socket/src/mls/seenOnMls.ts");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const row = (id, minute, extra = {}) => ({
  conversation_id: "dm_1",
  message_id: id,
  sender_server_id: "kari",
  text: id,
  attachments: null,
  reactions: null,
  created_at: new Date(Date.UTC(2026, 8, 28, 10, minute)).toISOString(),
  ...extra,
});
const ids = (list) => list.map((m) => m.message_id);

test("the merge drops placeholder lines and interleaves both sides by time", () => {
  const placeholder = row("ph", 3, { sender_server_id: "system", mls_placeholder: { seq: 1, sender_server_id: "kari" } });
  assert.equal(isMlsPlaceholder(placeholder), true);
  const merged = mergeTimeline({
    server: [row("old", 1), placeholder],
    serverHasMore: false,
    archived: [row("mls-a", 3, { mls: true }), row("mls-b", 5, { mls: true })],
    archiveHasMore: false,
  });
  assert.deepEqual(ids(merged), ["old", "mls-a", "mls-b"]);
});

test("the merge holds back what's older than the other side has loaded", () => {
  const merged = mergeTimeline({
    server: [row("s4", 4), row("s6", 6)],
    serverHasMore: true,
    archived: [row("a1", 1, { mls: true }), row("a5", 5, { mls: true })],
    archiveHasMore: false,
  });
  assert.deepEqual(ids(merged), ["s4", "a5", "s6"]);
});

test("a failed draft stays whatever its time, and one id shows once", () => {
  const merged = mergeTimeline({
    server: [row("s1", 1)],
    serverHasMore: false,
    archived: [row("a2", 2, { mls: true }), row("x", 0, { failed: true, mls: true }), row("a2", 2, { mls: true })],
    archiveHasMore: true,
  });
  assert.deepEqual(ids(merged), ["x", "a2"]);
});

test("an archived message becomes a row with its reply, edit and files", () => {
  const m = {
    scope: "s",
    conversationId: "dm_1",
    messageId: "m1",
    sentAt: 1000,
    senderId: "ola",
    text: "hei",
    attachments: { f1: key("a") },
    editedAt: 2000,
    replyTo: "m0",
  };
  const r = archivedRow(m, () => "Ola");
  assert.equal(r.sender_nickname, "Ola");
  assert.equal(r.created_at, new Date(1000).toISOString());
  assert.equal(r.edited_at, new Date(2000).toISOString());
  assert.equal(r.reply_to_message_id, "m0");
  assert.deepEqual(r.attachments, ["f1"]);
  assert.equal(r.mls, true);
  assert.equal(archivedRow({ ...m, attachments: {}, text: "" }, () => undefined).attachments, null);
});

function key(id) {
  return { id, key: "k".repeat(43), iv: "i".repeat(16), mime: "image/png" };
}

test("every uploaded file's key goes in the message, and a file with no key stops it", () => {
  assert.deepEqual(newMessage("m", "", "r", { ids: ["f1", "f2"], keys: { f1: key("a"), f2: key("b") } }), {
    type: "message",
    id: "m",
    text: "",
    replyTo: "r",
    attachments: { f1: key("a"), f2: key("b") },
  });
  assert.deepEqual(newMessage("m", "hei", null, null), { type: "message", id: "m", text: "hei" });
  assert.equal(newMessage("m", "hei", null, { ids: ["f1", "f2"], keys: { f1: key("a") } }), null);
});

test("files show as they open, and one that won't open shows as its id", () => {
  const r = row("m", 1, { attachments: ["f1", "f2", "f3"], mls: true });
  const opened = new Map([
    ["f1", { file_id: "f1", local_url: "blob:f1" }],
    ["f3", "failed"],
  ]);
  const shown = withOpenedFiles(r, opened).enriched_attachments;
  assert.deepEqual(shown.map((a) => a.file_id), ["f1", "f3"]);
  assert.equal(shown[1].mime, null);
  assert.equal(withOpenedFiles(r, new Map()).enriched_attachments, undefined);
});

test("the composer line: quiet when healthy, says why otherwise, and on the web where history lives", () => {
  const none = { undecryptable: 0, lost: null };
  const app = { lostHistory: false, home: "app", peerName: "Ola" };
  assert.equal(mlsNotice({ kind: "mls" }, none, app), null);
  assert.equal(mlsNotice({ kind: "sealed-v1", reason: "peer_without_mls" }, none, app), null);
  assert.match(mlsNotice({ kind: "refused", reason: "peer_left_mls" }, none, app), /Ola/);
  assert.equal(mlsNotice({ kind: "mls" }, { undecryptable: 1, lost: null }, app), "1 message couldn't be decrypted on this device.");
  assert.match(mlsNotice({ kind: "mls" }, { undecryptable: 3, lost: null }, app), /3 messages/);
  assert.match(mlsNotice({ kind: "mls" }, { undecryptable: 0, lost: "removed" }, app), /taken out/);
  assert.equal(mlsNotice({ kind: "mls" }, none, { ...app, lostHistory: true }), "Older messages were cleared from this device.");
  assert.match(mlsNotice({ kind: "mls" }, none, { ...app, home: "browser" }), /this browser/);
  assert.equal(mlsNotice({ kind: "sealed-v1", reason: "peer_without_mls" }, none, { ...app, home: "browser" }), null);
});

test("a failed send names what somebody can do something about", () => {
  assert.match(sendFailure({ code: "peer_unverified" }, "app"), /keys/);
  assert.match(sendFailure({ code: "waiting_for_welcome" }, "browser"), /This browser/);
  assert.equal(sendFailure(new Error("socket"), "app"), "Not sent.");
});

function memoryArchive() {
  const rows = new Map();
  return {
    rows,
    get: async (_s, _c, id) => rows.get(id) ?? null,
    put: async (ms) => void ms.forEach((m) => rows.set(m.messageId, m)),
    remove: async (_s, _c, id) => void rows.delete(id),
  };
}
const base = { scope: "s", conversationId: "dm_1", at: 1000 };

test("a sender's message is stored, edited and deleted", async () => {
  const db = memoryArchive();
  await applyMlsContent(db, { ...base, senderId: "ola", content: { type: "message", id: "m", text: "hei", replyTo: "q" } });
  await applyMlsContent(db, { ...base, at: 2000, senderId: "ola", content: { type: "edit", id: "m", text: "hallo" } });
  const edited = db.rows.get("m");
  assert.equal(edited.text, "hallo");
  assert.equal(edited.editedAt, 2000);
  assert.equal(edited.sentAt, 1000);
  assert.equal(edited.replyTo, "q");
  await applyMlsContent(db, { ...base, senderId: "ola", content: { type: "delete", id: "m" } });
  assert.equal(db.rows.has("m"), false);
});

test("somebody else can't overwrite, edit or delete your message", async () => {
  const db = memoryArchive();
  await applyMlsContent(db, { ...base, senderId: "me", content: { type: "message", id: "m", text: "mine" } });
  await applyMlsContent(db, { ...base, senderId: "ola", content: { type: "message", id: "m", text: "theirs" } });
  await applyMlsContent(db, { ...base, senderId: "ola", content: { type: "edit", id: "m", text: "edited" } });
  await applyMlsContent(db, { ...base, senderId: "ola", content: { type: "delete", id: "m" } });
  assert.equal(db.rows.get("m").text, "mine");
  await applyMlsContent(db, { ...base, senderId: "ola", content: { type: "edit", id: "gone", text: "x" } });
  assert.equal(db.rows.size, 1);
});

function fakeSocket(reply) {
  const sent = [];
  return {
    sent,
    emit(event, payload, ack) {
      sent.push({ event, payload });
      const r = reply(event, payload);
      if (r !== undefined) queueMicrotask(() => ack(r));
    },
  };
}
const token = async () => "token-1";

test("the transport adds the token and turns binary back into Uint8Arrays", async () => {
  const socket = fakeSocket((event) =>
    event === "mls:log:fetch"
      ? { ok: true, group: null, entries: [{ seq: 1, data: new Uint8Array([1, 2]).buffer }], nextCursor: 1, hasMore: false, gap: false }
      : { ok: true, welcomes: [{ welcomeId: "w", data: Buffer.from([3]) }], groups: [], registered: true, keyPackages: {} },
  );
  const t = socketMlsTransport({ socket, getAccessToken: token });
  const log = await t.fetchLog({ conversationId: "dm_1", after: 0 });
  const sync = await t.sync({ deviceId: "d" });
  assert.deepEqual(socket.sent[0], { event: "mls:log:fetch", payload: { accessToken: "token-1", conversationId: "dm_1", after: 0 } });
  assert.deepEqual(log.entries[0].data, new Uint8Array([1, 2]));
  assert.ok(sync.welcomes[0].data instanceof Uint8Array);
  assert.deepEqual(asBytes(new Uint8Array([0, 1, 2, 3]).subarray(1, 3)), new Uint8Array([1, 2]));
});

test("the transport refuses with no token, and times out a silent server", async () => {
  const socket = fakeSocket(() => undefined);
  const none = socketMlsTransport({ socket, getAccessToken: async () => null });
  assert.equal((await none.listDevices({})).error, "unauthenticated");
  assert.equal(socket.sent.length, 0);
  const silent = socketMlsTransport({ socket, getAccessToken: token, timeoutMs: 5 });
  assert.equal((await silent.listDevices({})).error, "timeout");
});

test("placeholder: false only for sends that aren't messages, and the uploads ride along", async () => {
  const socket = fakeSocket(() => ({ ok: true, seq: 4 }));
  let placeholder = true;
  const t = socketMlsTransport({ socket, getAccessToken: token, placeholderFor: () => placeholder });
  const req = { conversationId: "dm_1", deviceId: "d", message: new Uint8Array([9]) };
  await t.send({ ...req, attachmentIds: ["file_a", "file_b"] });
  placeholder = false;
  await t.send({ ...req, attachmentIds: [] });
  assert.equal("placeholder" in socket.sent[0].payload, false);
  assert.deepEqual(socket.sent[0].payload.attachmentIds, ["file_a", "file_b"]);
  assert.equal(socket.sent[1].payload.placeholder, false);
  assert.equal("attachmentIds" in socket.sent[1].payload, false);
});

test("KeyPackages are made again on the server's clock once, after an out-of-date refusal", async () => {
  let calls = 0;
  const socket = fakeSocket(() =>
    ++calls === 1
      ? { ok: false, error: "key_package_not_yet_valid", message: "fast clock", serverTime: 1_800_000_000 }
      : { ok: true, stored: 1, unclaimed: 1, lastResort: true },
  );
  const remade = [];
  const remake = async (req, serverTime) => {
    remade.push(serverTime);
    return { deviceId: req.deviceId, keyPackages: [new Uint8Array([7])] };
  };
  const t = socketMlsTransport({ socket, getAccessToken: token, remake });
  const r = await t.publishKeyPackages({ deviceId: "d", keyPackages: [new Uint8Array([1])] });
  assert.equal(r.ok, true);
  assert.deepEqual(remade, [1_800_000_000]);
  assert.deepEqual(socket.sent[1].payload.keyPackages, [new Uint8Array([7])]);

  const refused = socketMlsTransport({
    socket: fakeSocket(() => ({ ok: false, error: "too_many_devices", message: "five" })),
    getAccessToken: token,
    remake,
  });
  assert.equal((await refused.publishKeyPackages({ deviceId: "d", keyPackages: [] })).error, "too_many_devices");
  assert.equal(remade.length, 1);
});

test("the person key is sent again once when the DM key hadn't landed, and nothing else retries", async () => {
  const answering = (...replies) => {
    const sent = [];
    return { sent, emit: (_e, payload, ack) => (sent.push(payload), ack(replies.shift())) };
  };
  const noWait = async () => undefined;
  const once = answering({ ok: false, error: "no_dm_key" }, { ok: true });
  assert.equal(await publishPersonKey(once, "t", "binding", noWait), true);
  assert.equal(once.sent.length, 2);

  const twice = answering({ ok: false, error: "no_dm_key" }, { ok: false, error: "no_dm_key" });
  assert.equal(await publishPersonKey(twice, "t", "b", noWait), false);
  const wrong = answering({ ok: false, error: "wrong_identity" });
  assert.equal(await publishPersonKey(wrong, "t", "b", noWait), false);
  assert.equal(wrong.sent.length, 1);
});

test("only version 1 with suite 1 counts as MLS", () => {
  assert.deepEqual(readMlsCapability({ version: 1, ciphersuites: [1], retentionDays: 14 }), {
    version: 1,
    ciphersuites: [1],
    retentionDays: 14,
  });
  assert.equal(readMlsCapability({ version: 2, ciphersuites: [1] }), null);
  assert.equal(readMlsCapability({ version: 1, ciphersuites: [3] }), null);
  assert.equal(readMlsCapability(undefined), null);
});

test("somebody seen on MLS stays seen, per server, across tabs", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const a = seenOnMlsFor("srv:a", storage);
  a.add("ola");
  a.add("ola");
  assert.equal(seenOnMlsFor("srv:a", storage).has("ola"), true);
  assert.equal(seenOnMlsFor("srv:b", storage).has("ola"), false);
  store.set("gryt_mls_seen:srv:a", "not json");
  assert.equal(a.has("ola"), false);
});

/* ── a DM while the archive won't open (GRYT-1553) ────────────────────── */

const memoryStorage = () => {
  const store = new Map();
  return { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
};
const modeOnly = (capability, reply = () => undefined, seen = seenOnMlsFor("srv:a", memoryStorage())) => {
  const socket = fakeSocket(reply);
  const source = createModeOnlySource({
    socket,
    storeScope: "srv:a",
    dmScope: "srv:a",
    serverUserId: "me",
    capability,
    getAccessToken: token,
    seen,
  });
  return { socket, source, seen };
};
const MLS = { version: 1, ciphersuites: [1], retentionDays: 30 };
const archiveClosed = (e) => e.code === "archive_closed";

test("with the archive shut and no MLS on the server, a DM still sends and reads over version 1", async () => {
  // Nothing here opens the archive: the source has no store, so this is the state a failed open leaves.
  const { socket, source } = modeOnly(null);
  const mode = await source.modeFor("dm_1", "kari");
  assert.deepEqual(mode, { kind: "sealed-v1", reason: "server_without_mls" });
  assert.equal(socket.sent.length, 0, "no MLS call to a server without MLS");

  const composer = dmComposer({ dmPeer: "kari", mode, waiting: false, archiveFailed: true });
  assert.deepEqual(composer, { path: "server", held: false, archiveProblem: false });

  // Reading is the server's history alone, with nothing from the archive.
  const shown = mergeTimeline({ server: [row("s1", 1), row("s2", 2)], serverHasMore: false, archived: [], archiveHasMore: false });
  assert.deepEqual(ids(shown), ["s1", "s2"]);
});

test("with the archive shut, a server that dropped MLS still says so", async () => {
  const seen = seenOnMlsFor("srv:a", memoryStorage());
  seen.add("kari");
  const { source } = modeOnly(null, undefined, seen);
  assert.deepEqual(await source.modeFor("dm_1", "kari"), { kind: "refused", reason: "server_dropped_mls" });
});

test("with the archive shut and MLS on the server, only a peer without MLS gets version 1", async () => {
  const devices = (list) => (event) => (event === "mls:devices" ? { ok: true, devices: list } : undefined);

  const without = modeOnly(MLS, devices([{ serverUserId: "me", deviceId: "d1" }]));
  assert.deepEqual(await without.source.modeFor("dm_1", "kari"), { kind: "sealed-v1", reason: "peer_without_mls" });
  assert.deepEqual(without.socket.sent.map((m) => m.event), ["mls:devices"]);

  const onMls = modeOnly(MLS, devices([{ serverUserId: "kari", deviceId: "k1" }]));
  await assert.rejects(onMls.source.modeFor("dm_1", "kari"), archiveClosed);
  assert.deepEqual(onMls.socket.sent.map((m) => m.event), ["mls:devices"], "nothing registered or published");
  await assert.rejects(onMls.source.send("dm_1", "kari", { type: "message", id: "n", text: "hi" }), archiveClosed);

  const composer = dmComposer({ dmPeer: "kari", mode: null, waiting: true, archiveFailed: true });
  assert.deepEqual(composer, { path: "none", held: true, archiveProblem: true });
});

test("the composer holds only a DM waiting on its mode or refused", () => {
  const base = { dmPeer: "kari", waiting: false, archiveFailed: false };
  assert.deepEqual(dmComposer({ ...base, dmPeer: null, mode: null }), { path: "server", held: false, archiveProblem: false });
  assert.equal(dmComposer({ ...base, mode: { kind: "mls" } }).path, "mls");
  assert.deepEqual(dmComposer({ ...base, mode: { kind: "refused", reason: "peer_left_mls" } }), {
    path: "none",
    held: true,
    archiveProblem: false,
  });
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`not ok - ${name}\n`, e);
  }
}
if (failed) {
  console.error(`${failed} of ${tests.length} failed`);
  process.exit(1);
}
console.log(`mls-dm: ${tests.length} passed`);
