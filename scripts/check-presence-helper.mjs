#!/usr/bin/env node
/**
 * The app's end of gryt-helper (GRYT-1605): finding it, reading it, and falling back to
 * the in-app socket from discordIpc.ts when it isn't running.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { connectHelper, helperPath, isPrivateDir, parseHelperLine } from "../electron/helperChannel.ts";
import { createPresenceSource } from "../electron/presenceHelper.ts";

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.stack ?? err.message}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, what, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return;
    await wait(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const dirs = [];
function privateDir(mode = 0o700) {
  const root = mkdtempSync(join(tmpdir(), "gph-"));
  dirs.push(root);
  const dir = join(root, "p");
  mkdirSync(dir);
  chmodSync(dir, mode);
  return dir;
}

/** Speaks the helper's side of the protocol, as helper/hub.go does. */
async function fakeHelper(dir, { hello = { type: "hello", version: 1, pid: 1, state: "holding", slot: 0 }, replay = [] } = {}) {
  const path = join(dir, "helper.sock");
  const clients = new Set();
  const received = [];
  const server = createServer((socket) => {
    clients.add(socket);
    socket.setEncoding("utf8");
    socket.on("data", (d) => received.push(...d.split("\n").filter(Boolean)));
    socket.on("close", () => clients.delete(socket));
    if (hello) socket.write(JSON.stringify(hello) + "\n" + replay.map((m) => JSON.stringify(m) + "\n").join(""));
  });
  await new Promise((r) => server.listen(path, r));
  return {
    path,
    received,
    clients,
    send: (msg) => {
      for (const c of clients) c.write(JSON.stringify(msg) + "\n");
    },
    close: () =>
      new Promise((r) => {
        for (const c of clients) c.destroy();
        server.close(r);
      }),
  };
}

const activity = (connection, clientId, details) => ({ type: "activity", connection, clientId, activity: details ? { details } : null });

/* ── Where it lives ──────────────────────────────────────────────────── */

await check("the path is the one helper/ listens on", () => {
  assert.equal(helperPath("darwin", {}, "/Users/a"), "/Users/a/Library/Application Support/chat.gryt.helper/helper.sock");
  assert.equal(helperPath("linux", { XDG_RUNTIME_DIR: "/run/user/1000" }, "/home/a"), "/run/user/1000/gryt-helper/helper.sock");
  assert.equal(helperPath("linux", {}, "/home/a"), "/home/a/.cache/gryt-helper/helper.sock");
  // Worked out with Go's crypto/sha256 over the same string, so both ends agree.
  assert.equal(helperPath("win32", { USERDOMAIN: "GRYT-PC", USERNAME: "Sivert" }), "\\\\.\\pipe\\gryt-helper-1e8dc84c3fa88525");
});

await check("only a folder nobody else can enter counts", () => {
  assert.equal(isPrivateDir(privateDir(0o700)), true);
  assert.equal(isPrivateDir(privateDir(0o755)), false);
  assert.equal(isPrivateDir(privateDir(0o700), 12345), false, "somebody else's folder");
  assert.equal(isPrivateDir("/does/not/exist"), false);
});

/* ── The protocol ────────────────────────────────────────────────────── */

await check("lines are checked before anything uses them", () => {
  assert.equal(parseHelperLine("not json"), null);
  assert.equal(parseHelperLine("[1]"), null);
  assert.equal(parseHelperLine('{"type":"hello","version":2,"state":"holding","slot":0}'), null, "a newer protocol");
  assert.deepEqual(parseHelperLine('{"type":"state","state":"holding","slot":1}'), { type: "state", state: "holding", slot: 1 });
  assert.deepEqual(parseHelperLine('{"type":"state","state":"holding"}'), { type: "state", state: "yielded", slot: null });
  assert.equal(parseHelperLine('{"type":"activity","connection":1,"clientId":"abc","activity":{}}'), null, "a bad client id");
  assert.deepEqual(parseHelperLine('{"type":"activity","connection":1,"clientId":"12","pid":5,"activity":[1]}'), {
    type: "activity",
    connection: 1,
    clientId: "12",
    pid: 5,
    activity: null,
  });
});

await check("reads the hello, what's showing, and updates, and can tell it to quit", async () => {
  const helper = await fakeHelper(privateDir(), { replay: [activity(3, "100", "Ranked")] });
  const events = [];
  const statuses = [];
  let closed = false;
  const link = await connectHelper({
    path: helper.path,
    platform: "linux",
    onActivity: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onClose: () => (closed = true),
  });
  assert.ok(link);
  assert.deepEqual(link.status(), { state: "holding", slot: 0 });
  await until(() => events.length === 1, "the replayed activity");
  assert.equal(events[0].activity.details, "Ranked");
  helper.send({ type: "state", state: "yielded", slot: null });
  await until(() => statuses.length === 2, "the state change");
  link.quit();
  await until(() => helper.received.includes('{"type":"quit"}'), "quit");
  await until(() => closed, "onClose");
  await helper.close();
});

await check("nothing is there, or it never says hello", async () => {
  const noop = { onActivity() {}, onStatus() {}, onClose() {} };
  assert.equal(await connectHelper({ ...noop, path: join(privateDir(), "helper.sock"), platform: "linux" }), null);

  const open = await fakeHelper(privateDir(0o755));
  assert.equal(await connectHelper({ ...noop, path: open.path, platform: "linux" }), null, "a folder others can enter");
  await open.close();

  const silent = await fakeHelper(privateDir(), { hello: null });
  assert.equal(await connectHelper({ ...noop, path: silent.path, platform: "linux", helloTimeoutMs: 100 }), null);
  await silent.close();
});

/* ── Helper first, the in-app socket otherwise ───────────────────────── */

function fakeHost() {
  const made = [];
  return {
    made,
    create: (opts) => {
      const host = { opts, started: false, stopped: false };
      made.push(host);
      return {
        start: async () => {
          host.started = true;
          opts.onState("holding", null);
          return "holding";
        },
        stop: async () => {
          host.stopped = true;
          opts.onState("off", null);
        },
        state: () => (host.stopped ? "off" : "holding"),
        holder: () => null,
      };
    },
  };
}

function source(path, hosts, extra = {}) {
  const events = [];
  const states = [];
  let resets = 0;
  const src = createPresenceSource({
    onActivity: (e) => events.push(e),
    onState: (state, holder, via) => states.push({ state, holder: holder?.name ?? null, via }),
    onReset: () => resets++,
    createHost: hosts.create,
    connect: (opts) => connectHelper({ ...opts, path, platform: "linux" }),
    findHolder: async () => ({ pid: 9, name: "Discord", isDiscord: true }),
    pollMs: 30,
    ...extra,
  });
  return { src, events, states, resets: () => resets };
}

await check("with the helper running, the app never opens its own socket", async () => {
  const helper = await fakeHelper(privateDir(), { replay: [activity(1, "100", "Ranked")] });
  const hosts = fakeHost();
  const s = source(helper.path, hosts);
  await s.src.start();
  assert.equal(hosts.made.length, 0);
  assert.equal(s.src.via(), "helper");
  await until(() => s.states.some((x) => x.via === "helper" && x.state === "holding"), "holding via the helper");
  await until(() => s.events.length === 1, "the replayed activity");
  await s.src.stop();
  await helper.close();
});

await check("without it, the in-app socket; and when it shows up, the app lets go for it", async () => {
  const dir = privateDir();
  const hosts = fakeHost();
  const s = source(join(dir, "helper.sock"), hosts);
  await s.src.start();
  assert.equal(hosts.made.length, 1);
  assert.equal(hosts.made[0].started, true);
  assert.equal(s.src.via(), "app");

  const helper = await fakeHelper(dir, { hello: { type: "hello", version: 1, state: "holding", slot: 1 }, replay: [activity(2, "200", "Lobby")] });
  await until(() => s.src.via() === "helper", "switching to the helper");
  assert.equal(hosts.made[0].stopped, true, "the in-app socket wasn't let go");
  assert.ok(s.resets() >= 1);
  await until(() => s.events.some((e) => e.clientId === "200"), "the helper's activity");
  // On slot 1, games reach whoever has slot 0 first, so settings names them.
  await until(() => s.states.at(-1).state === "yielded" && s.states.at(-1).holder === "Discord", "the holder of slot 0");
  helper.send({ type: "state", state: "holding", slot: 0 });
  await until(() => s.states.at(-1).state === "holding" && s.states.at(-1).via === "helper", "holding slot 0");

  // The helper going away brings the in-app socket back.
  await helper.close();
  await until(() => hosts.made.length === 2 && hosts.made[1].started, "falling back");
  assert.equal(s.src.via(), "app");
  await s.src.stop();
  assert.equal(hosts.made[1].stopped, true);
});

await check("turning it off stops the helper too, and a plain stop leaves it running", async () => {
  const helper = await fakeHelper(privateDir());
  const s = source(helper.path, fakeHost());
  await s.src.start();
  await s.src.stop();
  await wait(50);
  assert.equal(helper.received.length, 0, "a quit of the app stopped the helper");

  const again = source(helper.path, fakeHost());
  await again.src.start();
  await again.src.stopAll();
  await until(() => helper.received.includes('{"type":"quit"}'), "quit");
  await helper.close();
});

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? "\npresence helper: ok" : `\npresence helper: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
