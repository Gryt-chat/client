/* eslint-env node */

// An MLS DM across a lost connection, with the app's own session and transport over a
// socket.io stand-in, and the real driver behind @gryt/core's fake server (GRYT-1584).

import assert from "node:assert/strict";

import type { MlsDmDriver } from "@gryt/core";
import { FakeDeliveryService, MemoryMlsStore } from "@gryt/core/testing";
import { asIdentityScope, createMlsDevice, derivePersonKeyPair, pinPeerKey, pinPersonKey } from "@gryt/crypto";

import type { ArchivedMessage, MessageArchive } from "@/common";

import type { SessionSocket } from "../src/packages/socket/src/mls/session.ts";

const { createMlsSession } = await import("../src/packages/socket/src/mls/session.ts");

const SCOPE = asIdentityScope("srv:restart-test");
const CAPABILITY = { version: 1, ciphersuites: [1], retentionDays: 30 };
const SEEDS = { kari: seed(3), ola: seed(5) };
const EVENTS = {
  "mls:keypackages:publish": "publishKeyPackages",
  "mls:keypackages:claim": "claimKeyPackages",
  "mls:devices": "listDevices",
  "mls:device:remove": "removeDevice",
  "mls:group:create": "createGroup",
  "mls:commit": "commit",
  "mls:send": "send",
  "mls:log:fetch": "fetchLog",
  "mls:sync": "sync",
  "mls:welcome:ack": "ackWelcomes",
} as const;

function seed(n: number) {
  return Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);
}

/** A socket.io socket as the session sees it: emits with acks, pushes, and a connection to lose. */
// The session types each listener for its event; fire() hands over whatever the push carries.
type Listener = (payload?: object) => void;

function socketTo(fake: FakeDeliveryService, who: string) {
  const { transport, socket: server } = fake.connect(who);
  const listeners = new Map<string, Set<Listener>>();
  const fire = (event: string, payload?: object) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
  };
  let dropNextAck = false;
  const socket: SessionSocket & { connected: boolean } = {
    connected: true,
    emit(event, payload, ack) {
      const req: Record<string, object | string | number> = { ...(payload as object) };
      delete req.accessToken;
      const lose = dropNextAck && event === "mls:send";
      if (lose) dropNextAck = false;
      const method = EVENTS[event as keyof typeof EVENTS];
      void (transport[method] as (req: object) => Promise<object>).call(transport, req).then((reply) => {
        if (lose) return;
        if (socket.connected) ack(reply);
      });
    },
    on(event, listener) {
      listeners.set(event, new Set([...(listeners.get(event) ?? []), listener as Listener]));
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener as Listener);
    },
  };
  const pushes: Pick<MlsDmDriver, "handleMessage" | "handleWelcome" | "handleDevicesChanged"> = {
    handleMessage: async (entry) => fire("mls:message", entry),
    handleWelcome: async (welcome) => fire("mls:welcome", welcome),
    handleDevicesChanged: async (push) => fire("mls:devices:changed", push),
  };
  // The fake server only pushes through these three.
  server.driver = pushes as MlsDmDriver;
  return {
    socket,
    /** The server stops answering and the socket notices, like a restart. */
    drop() {
      socket.connected = false;
      server.reachable = false;
      fire("disconnect");
    },
    back() {
      socket.connected = true;
      server.reachable = true;
      fire("connect");
    },
    /** The server writes the next mls:send and dies before it acks. */
    loseNextAck() {
      dropNextAck = true;
    },
  };
}

function archive() {
  const rows = new Map<string, ArchivedMessage>();
  const key = (scope: string, conversationId: string, id: string) => `${scope}|${conversationId}|${id}`;
  const store: Pick<MessageArchive, "get" | "put" | "remove"> = {
    get: async (scope, conversationId, id) => rows.get(key(scope, conversationId, id)) ?? null,
    put: async (list) => list.forEach((m) => rows.set(key(m.scope, m.conversationId, m.messageId), structuredClone(m))),
    remove: async (scope, conversationId, id) => void rows.delete(key(scope, conversationId, id)),
  };
  // Only the three calls the session makes.
  return { rows, store: store as MessageArchive };
}

function member(fake: FakeDeliveryService, who: "kari" | "ola") {
  const peer = who === "kari" ? "ola" : "kari";
  type PinStore = Parameters<typeof pinPeerKey>[0];
  let pins: ReturnType<PinStore["read"]> = {};
  const pinStore: PinStore = { read: () => structuredClone(pins), write: (p) => void (pins = structuredClone(p)) };
  pinPeerKey(pinStore, SCOPE, peer, { dmPublicKey: new Uint8Array(32), identityThumbprint: `id-${peer}`, scope: SCOPE, signedAt: 0 });
  pinPersonKey(pinStore, SCOPE, peer, {
    personPublicKey: new Uint8Array(derivePersonKeyPair(SEEDS[peer], SCOPE).publicKey),
    identityThumbprint: `id-${peer}`,
    scope: SCOPE,
    signedAt: 0,
  });
  const seen = new Set();
  const line = socketTo(fake, who);
  const messages = archive();
  const session = createMlsSession({
    socket: line.socket,
    storeScope: SCOPE,
    dmScope: SCOPE,
    serverUserId: who,
    capability: CAPABILITY,
    getAccessToken: async () => "token",
    messages: messages.store,
    store: new MemoryMlsStore(),
    pinStore,
    seen: { has: (id: string) => seen.has(id), add: (id: string) => void seen.add(id) },
    ownPersonKey: derivePersonKeyPair(SEEDS[who], SCOPE).publicKey,
    newDevice: async () => createMlsDevice({ seed: SEEDS[who], scope: SCOPE, deviceName: who }),
  });
  const texts = () => [...messages.rows.values()].sort((a, b) => a.sentAt - b.sentAt).map((m) => m.text);
  return { session, line, messages, texts };
}

async function until(what: string, check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function pair() {
  const fake = new FakeDeliveryService(SCOPE);
  const dm = fake.dm("kari", "ola");
  const kari = member(fake, "kari");
  const ola = member(fake, "ola");
  await kari.session.start();
  await ola.session.start();
  await kari.session.send(dm, "ola", { type: "message", id: "m0", text: "before" });
  await until("ola to read the first message", () => ola.texts().includes("before"));
  const sent = () => (fake.groups.get(dm)?.log ?? []).filter((e) => e.kind === "application").length;
  return { fake, dm, kari, ola, sent };
}

const tests: { name: string; fn: () => Promise<void> }[] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push({ name, fn });

test("a DM sent while the server is down waits, says so, and goes out once it's back", async () => {
  const { dm, kari, ola, sent } = await pair();
  kari.line.drop();
  let done = false;
  const sending = kari.session.send(dm, "ola", { type: "message", id: "m1", text: "while down" }).finally(() => (done = true));
  await until("the session to say it's waiting", () => kari.session.waiting());
  assert.equal(done, false);

  kari.line.back();
  await kari.session.start();
  await sending;
  assert.equal(kari.session.waiting(), false);
  await until("ola to read it", () => ola.texts().includes("while down"));
  assert.equal(sent(), 2);
  assert.deepEqual(kari.texts(), ["before", "while down"]);
});

test("one written by the server whose ack was lost goes out once, not twice", async () => {
  const { dm, kari, ola, sent } = await pair();
  kari.line.loseNextAck();
  const sending = kari.session.send(dm, "ola", { type: "message", id: "m1", text: "ack lost" });
  await until("the server to write it", () => sent() === 2);
  kari.line.drop();
  await until("the session to say it's waiting", () => kari.session.waiting());
  kari.line.back();
  await kari.session.start();
  await sending;
  await until("ola to read it", () => ola.texts().includes("ack lost"));
  assert.equal(sent(), 2, "the log holds it once");
  assert.deepEqual(ola.texts(), ["before", "ack lost"]);
});

test("sends typed while down go out in order", async () => {
  const { dm, kari, ola } = await pair();
  kari.line.drop();
  const sends = ["one", "two", "three"].map((text, i) => kari.session.send(dm, "ola", { type: "message", id: `n${i}`, text }));
  await until("the session to say it's waiting", () => kari.session.waiting());
  kari.line.back();
  await kari.session.start();
  await Promise.all(sends);
  await until("ola to read all three", () => ola.texts().length === 4);
  const seqs = [...ola.messages.rows.values()].map((m) => m.text);
  assert.deepEqual(seqs, ["before", "one", "two", "three"]);
});

test("the transport answers offline without emitting while the socket is down", async () => {
  const { dm, kari } = await pair();
  const emitted: string[] = [];
  const emit = kari.line.socket.emit;
  kari.line.socket.emit = (event, ...rest) => {
    emitted.push(event);
    return emit(event, ...rest);
  };
  kari.line.drop();
  const sending = kari.session.send(dm, "ola", { type: "message", id: "m1", text: "held" });
  await until("the session to say it's waiting", () => kari.session.waiting());
  assert.deepEqual(emitted, []);
  await kari.session.dispose();
  await assert.rejects(sending, (e: Error & { code?: string }) => e.code === "stopped");
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}
if (failed) {
  console.error(`\n${failed} of ${tests.length} failed`);
  process.exit(1);
}
console.log(`\nall ${tests.length} passed`);
process.exit(0);
