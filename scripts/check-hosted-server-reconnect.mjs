/* eslint-env node */

// A server this app hosts is tried the moment it comes up, whether its socket was waiting on a
// retry or had given up, and a server that crashes on start cannot make it loop. GRYT-1207.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { io } from "socket.io-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const HOOK = "src/packages/socket/src/hooks/useSockets.ts";
const MANAGER = "electron/embeddedServerManager.ts";
const hook = read(HOOK);

const { railEntriesJustStarted } = await import("../src/packages/settings/src/hostedServerRail.ts");
const { replayReconnect, retryNow } = await import("../src/packages/socket/src/utils/retryNow.ts");

// What engine.io-client itself opens sockets with in Node, so it is here whenever the client is.
const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(require.resolve("engine.io-client"))("ws");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Resolves on the next `event`, and fails the check if it has not come within `ms`. */
function next(emitter, event, ms, what) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, on);
      reject(new Error(`${what}: no ${event} within ${ms}ms`));
    }, ms);
    const on = (...args) => {
      clearTimeout(timer);
      emitter.off(event, on);
      resolve(args);
    };
    emitter.on(event, on);
  });
}

/** A declaration's body, from its first brace to the one that closes it. */
function bodyOf(text, from, where) {
  const at = text.indexOf(from);
  assert.notEqual(at, -1, `${where} no longer has "${from}". Move this check with it.`);
  const start = text.indexOf("{", at + from.length);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after "${from}" in ${where}`);
}

/* ── the real thing: socket.io-client against a server that goes and comes back ── */

/** Enough engine.io and socket.io for a client to connect, on one port that can close and reopen. */
function fakeServer() {
  let http = null;
  let wss = null;
  let port = 0;
  const server = {
    accepted: 0,
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    async up() {
      http = createServer();
      wss = new WebSocketServer({ server: http });
      wss.on("connection", (ws) => {
        const n = ++server.accepted;
        const open = { sid: `engine${n}`, upgrades: [], pingInterval: 60_000, pingTimeout: 60_000, maxPayload: 1_000_000 };
        ws.send(`0${JSON.stringify(open)}`);
        ws.on("message", (data) => {
          if (String(data).startsWith("40")) ws.send(`40${JSON.stringify({ sid: `socket${n}` })}`);
        });
      });
      await new Promise((resolve) => http.listen(port, "127.0.0.1", resolve));
      port = http.address().port;
    },
    async down() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
  return server;
}

const clients = [];
const servers = [];

/** The options useSockets opens with, and delays short enough for a check. */
async function connected(options) {
  const server = fakeServer();
  servers.push(server);
  await server.up();
  const socket = io(server.url, { transports: ["websocket"], forceNew: true, randomizationFactor: 0, ...options });
  clients.push(socket);
  await next(socket, "connect", 3_000, "the first connection");
  return { server, socket };
}

try {
  // Waiting on a retry: the reported shape after a short stop, where nothing hurried the socket.
  {
    const { server, socket } = await connected({ reconnectionDelay: 2_000, reconnectionDelayMax: 10_000 });
    await server.down();
    await next(socket.io, "reconnect_error", 5_000, "the first retry");
    await server.up();

    const calls = [];
    const started = Date.now();
    retryNow(socket, (reconnectRan) => calls.push(reconnectRan));
    await next(socket, "connect", 1_500, "retryNow with socket.io's next retry four seconds away");
    assert.ok(Date.now() - started < 1_500, "retryNow waited for the queued retry");
    assert.deepEqual(calls, [false], "the follow-up did not run once, for a connection socket.io's reconnect did not handle");
  }

  // Given up: the reported shape after a stop of more than two minutes.
  {
    const { server, socket } = await connected({ reconnectionAttempts: 2, reconnectionDelay: 50, reconnectionDelayMax: 50 });
    await server.down();
    await next(socket.io, "reconnect_failed", 3_000, "running out of attempts");
    await server.up();
    await sleep(300);
    assert.equal(socket.connected, false, "a socket that gave up came back by itself, so this case proves nothing");

    const calls = [];
    retryNow(socket, (reconnectRan) => calls.push(reconnectRan));
    await next(socket, "connect", 1_500, "retryNow on a socket that gave up");
    assert.deepEqual(calls, [false]);
  }

  // Crashed straight after starting: one try now, the ordinary backoff after it, then quiet.
  {
    const { server, socket } = await connected({ reconnectionAttempts: 3, reconnectionDelay: 200, reconnectionDelayMax: 400 });
    await server.down();
    await next(socket.io, "reconnect_failed", 5_000, "running out of attempts");

    let tries = 0;
    socket.on("connect_error", () => tries++);
    const started = Date.now();
    retryNow(socket, () => assert.fail("connected to a server that is down"));
    await next(socket.io, "reconnect_failed", 5_000, "running out of attempts again");
    const took = Date.now() - started;
    assert.equal(tries, 4, `a server that is down was tried ${tries} times, not once now and three retries`);
    assert.ok(took >= 950, `the retries were ${took}ms in all, quicker than the backoff's 200 + 400 + 400`);
    await sleep(1_000);
    assert.equal(tries, 4, "the socket kept trying after it gave up");
  }

  // Start pressed again and again while it stays down leaves one follow-up, and it runs once.
  {
    const { server, socket } = await connected({ reconnectionDelay: 300, reconnectionDelayMax: 300 });
    const before = { connect: socket.listeners("connect").length, reconnect: socket.io.listeners("reconnect").length };
    await server.down();

    const calls = [];
    for (const press of [1, 2, 3, 4, 5]) retryNow(socket, () => calls.push(press));
    assert.equal(socket.listeners("connect").length, before.connect + 1, "five retries left five connect listeners waiting");
    assert.equal(socket.io.listeners("reconnect").length, before.reconnect + 1, "five retries left five reconnect listeners waiting");

    await sleep(100);
    await server.up();
    await next(socket, "connect", 3_000, "the socket after five retries");
    await settle();
    assert.deepEqual(calls, [5], "an earlier retry's follow-up ran, or the last one ran more than once");
    assert.equal(socket.listeners("connect").length, before.connect, "a finished retry left its connect listener behind");
    assert.equal(socket.io.listeners("reconnect").length, before.reconnect, "a finished retry left its reconnect listener behind");
  }

  // However it connects, socket.io's reconnect handling runs once: replayed, or by socket.io.
  {
    const { server, socket } = await connected({ reconnectionDelay: 400, reconnectionDelayMax: 400 });
    let reconnects = 0;
    socket.io.on("reconnect", () => reconnects++);
    const caller = (seen) => (reconnectRan) => {
      seen.push(reconnectRan);
      if (!reconnectRan) replayReconnect(socket);
    };

    await server.down();
    await next(socket.io, "reconnect_error", 2_000, "the first retry");
    await server.up();
    const fresh = [];
    retryNow(socket, caller(fresh));
    await next(socket, "connect", 1_500, "retryNow with the server back");
    await settle();
    assert.deepEqual(fresh, [false], "a fresh connection was taken for socket.io's own reconnect");
    assert.equal(reconnects, 1, `a fresh connection ran the reconnect handling ${reconnects} times, not once`);

    // Tried a moment before the server listens, as when the manager says running early.
    await server.down();
    await next(socket.io, "reconnect_error", 2_000, "the first retry");
    const early = [];
    retryNow(socket, caller(early));
    await next(socket, "connect_error", 1_000, "the try against a server not listening yet");
    await server.up();
    await next(socket, "connect", 2_000, "socket.io's own retry");
    await settle();
    assert.deepEqual(early, [true], "socket.io's own reconnect was not noticed");
    assert.equal(reconnects, 2, `socket.io's own reconnect ran the handling ${reconnects - 1} times, not once`);
  }
} finally {
  for (const socket of clients) socket.disconnect();
  for (const server of servers) await server.down().catch(() => {});
}

/* ── which status changes count as a start ────────────────────────────────── */

const LIFECYCLE = (() => {
  const union = read(MANAGER).match(/export type ServerStatus = ([^;]+);/);
  assert.ok(union, `${MANAGER} no longer declares ServerStatus. Move this check with it.`);
  return [...union[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
})();
assert.deepEqual([...LIFECYCLE].sort(), ["error", "running", "starting", "stopped"], `${MANAGER} has a status this check has not decided about`);

function hosted(id, serverName, serverPort, status) {
  const config = { id, serverName, serverPort, sfuPort: 5005, mediaPort: 3478, lanDiscoverable: true, externalHost: `http://127.0.0.1:${serverPort}`, advertisedAddresses: ["192.168.1.20"], customAdvertisedAddresses: [] };
  return { id, status, error: null, serverUrl: `http://127.0.0.1:${serverPort}`, config };
}
const DEN = "test-den-e1bf65";
const LOFT = "test-loft-4d5e6f";
const den = (status) => hosted(DEN, "Test Den", 5040, status);
const loft = (status) => hosted(LOFT, "Test Loft", 5041, status);

const RAIL = {
  "127.0.0.1:5040": { host: "127.0.0.1:5040", name: "Test Den", serverId: `test_den_5040_${DEN}` },
  "192.168.1.20:5040": { host: "192.168.1.20:5040", name: "Test Den", serverId: `test_den_5040_${DEN}` },
  "127.0.0.1:5041": { host: "127.0.0.1:5041", name: "Test Loft", serverId: `test_loft_5041_${LOFT}` },
  "gryt.example.com": { host: "gryt.example.com", name: "Test Den", serverId: "test_den_5040_someone-else" },
};
const DEN_ENTRIES = ["127.0.0.1:5040", "192.168.1.20:5040"];

/* The effect as written in useSockets, handed a fake preload API. What it retries goes
   to `retried`, one host per retry. */
const trigger = (() => {
  const at = hook.indexOf("api.onEmbeddedServerStatusChanged(");
  assert.notEqual(at, -1, `${HOOK} no longer listens to the embedded manager's status. Move this check with it.`);
  const body = bodyOf(hook.slice(hook.lastIndexOf("useEffect(() =>", at)), "useEffect(() =>", HOOK);
  assert.ok(body.includes("api.onEmbeddedServerStatusChanged("), "the effect read here is not the one that listens to the manager");
  return new Function(
    "getElectronAPI",
    "railEntriesJustStarted",
    "serversRef",
    "retryHostedServer",
    `${stripTypeScriptTypes(`function effect() ${body}`)}\nreturn effect();`,
  );
})();

function mount({ seed = [], rail = RAIL, api: override } = {}) {
  let push = null;
  const retried = [];
  const api = override === null ? null : {
    getEmbeddedServerStatus: typeof seed === "function" ? seed : async () => seed,
    onEmbeddedServerStatusChanged: (callback) => {
      push = callback;
      return () => {
        push = null;
      };
    },
  };
  const cleanup = trigger(() => api, railEntriesJustStarted, { current: rail }, (host) => retried.push(host));
  return {
    retried,
    cleanup,
    push: (states) => {
      assert.ok(push, "the effect did not subscribe, or unsubscribed");
      push(states);
    },
    get subscribed() {
      return push !== null;
    },
  };
}

// Stopped, starting, running: each rail entry for it is retried once, at running.
{
  const app = mount({ seed: [den("stopped")] });
  await settle();
  app.push([den("starting")]);
  assert.deepEqual(app.retried, [], "a server still booting was retried");
  app.push([den("running")]);
  assert.deepEqual([...app.retried].sort(), DEN_ENTRIES, "a server that came up was not retried at every address it is in the rail under");
  app.push([den("running")]);
  app.push([den("running"), loft("stopped")]);
  assert.equal(app.retried.length, DEN_ENTRIES.length, "the same running server was retried again when the manager repeated itself");
}

// Crashes straight after starting: one retry, not one per status after it.
{
  const app = mount({ seed: [den("stopped")] });
  await settle();
  for (const status of ["starting", "running", "error", "error", "stopped", "stopped"]) app.push([den(status)]);
  assert.equal(app.retried.length, DEN_ENTRIES.length, `a crash on start retried ${app.retried.length / DEN_ENTRIES.length} times`);
}

// Start pressed five times on a server that crashes every time: one retry per start, no more.
{
  const app = mount({ seed: [den("error")] });
  await settle();
  for (let press = 0; press < 5; press++) {
    for (const status of ["starting", "running", "error"]) app.push([den(status)]);
  }
  assert.equal(app.retried.length, 5 * DEN_ENTRIES.length, `five starts made ${app.retried.length / DEN_ENTRIES.length} rounds of retries`);
}

// Only the server that came up, and never a stranger's server holding a look-alike id.
{
  const app = mount({ seed: [den("running"), loft("stopped")] });
  await settle();
  app.push([den("running"), loft("starting")]);
  app.push([den("running"), loft("running")]);
  assert.deepEqual(app.retried, ["127.0.0.1:5041"], "another server's start retried this one, or somebody else's");
}

// Already running when first seen, as at launch after the renderer loads: nothing says it just started.
{
  const app = mount({ seed: [den("running")] });
  await settle();
  app.push([den("running")]);
  assert.deepEqual(app.retried, [], "a server that was already up was retried");

  const late = mount({ seed: [] });
  await settle();
  late.push([den("running")]);
  assert.deepEqual(late.retried, [], "a server first seen running was retried");
}

// A seed that answers after the first status change does not replace what that change said.
{
  let answer;
  const app = mount({ seed: () => new Promise((resolve) => { answer = resolve; }) });
  app.push([den("running")]);
  answer([den("stopped")]);
  await settle();
  app.push([den("running")]);
  assert.deepEqual(app.retried, [], "an older status from the seed made a running server look newly started");
}

// Every status the manager has, into every other: only arriving at running counts.
for (const before of LIFECYCLE) {
  for (const after of LIFECYCLE) {
    const app = mount({ seed: [den(before)] });
    await settle();
    app.push([den(after)]);
    const expected = after === "running" && before !== "running" ? DEN_ENTRIES : [];
    assert.deepEqual([...app.retried].sort(), expected, `${before} to ${after} retried ${app.retried.length ? "" : "nothing, not "}the rail entries`);
  }
}

// A rail with none of its entries, a browser, and unmounting.
{
  const empty = mount({ seed: [den("stopped")], rail: {} });
  await settle();
  empty.push([den("running")]);
  assert.deepEqual(empty.retried, [], "a server nobody has in the rail was retried");

  const browser = mount({ api: null });
  assert.equal(browser.cleanup, undefined, "a browser subscribed to an embedded manager it does not have");

  const app = mount({ seed: [den("stopped")] });
  await settle();
  app.cleanup();
  assert.equal(app.subscribed, false, "unmounting left the status listener behind");
}

/* ── what a retry does to one socket ──────────────────────────────────────── */

function fakeSocket({ connected = false, refused = false } = {}) {
  const emitted = [];
  return {
    connected,
    active: true,
    io: { opts: { reconnection: refused ? false : true } },
    emitted,
    emit: (event) => emitted.push(event),
    connect: () => assert.fail("a retry called connect() alone, which waits out a queued retry"),
  };
}

function spies({ session }) {
  const calls = { status: [], retry: [], replay: [], removedToken: 0 };
  return {
    calls,
    setServerConnectionStatus: (update) => calls.status.push(update({})),
    retryNow: (socket, onConnect) => calls.retry.push({ socket, onConnect }),
    replayReconnect: (socket) => calls.replay.push(socket),
    hasSession: () => session,
    getServerAccessToken: () => (session ? "token" : null),
    removeServerAccessToken: () => calls.removedToken++,
  };
}

function callbackOf(name) {
  const at = hook.indexOf(`const ${name} = useCallback(`);
  assert.notEqual(at, -1, `${HOOK} no longer declares ${name} with useCallback. Move this check with it.`);
  const arrow = hook.indexOf("=>", at);
  return stripTypeScriptTypes(`const f = (host: string) => ${bodyOf(hook.slice(arrow), "=>", HOOK)};`);
}

// The hosted retry: a socket that is connected or refused is left alone, and nothing joins again.
{
  const source = callbackOf("retryHostedServer");
  assert.ok(!/server:join|requestServerState|removeServerAccessToken/.test(source), "the hosted retry can join again, which drops the token of a socket that has not connected yet");

  const run = (sockets, session) => {
    const s = spies({ session });
    new Function("socketsRef", "setServerConnectionStatus", "retryNow", "replayReconnect", "hasSession", "host", `${source}\nreturn f(host);`)(
      { current: sockets }, s.setServerConnectionStatus, s.retryNow, s.replayReconnect, s.hasSession, "127.0.0.1:5040",
    );
    return s.calls;
  };

  assert.equal(run({}, true).retry.length, 0, "a host with no socket was retried");
  assert.equal(run({ "127.0.0.1:5040": fakeSocket({ connected: true }) }, true).retry.length, 0, "a connected socket was retried");
  assert.equal(run({ "127.0.0.1:5040": fakeSocket({ refused: true }) }, true).retry.length, 0, "a server refused for failing its proof was retried");

  for (const session of [true, false]) {
    const socket = fakeSocket();
    const calls = run({ "127.0.0.1:5040": socket }, session);
    assert.equal(calls.retry.length, 1, "a socket that is down was not retried once");
    assert.equal(calls.retry[0].socket, socket);
    assert.deepEqual(calls.status, [{ "127.0.0.1:5040": "connecting" }], "the rail was not told the server is being tried");

    calls.retry[0].onConnect(true);
    assert.equal(calls.replay.length, 0, "socket.io's own reconnect ran, and was replayed on top");
    calls.retry[0].onConnect(false);
    assert.equal(calls.replay.length, session ? 1 : 0, session ? "a socket back with a session did not get the reconnect handling" : "a socket with no session was handed reconnect handling");
    assert.deepEqual(socket.emitted, [], "the hosted retry sent something itself");
  }
}

// The Reconnect button: the same retry, and it still joins again when there is no session.
{
  const source = callbackOf("reconnectServer");
  const run = (socket, session) => {
    const s = spies({ session });
    const nickname = "Sivert";
    new Function(
      "sockets", "getServerAccessToken", "removeServerAccessToken", "serverDetailsListRef", "serversRef", "nickname",
      "setServerConnectionStatus", "retryNow", "replayReconnect", "hasSession", "host",
      `${source}\nreturn f(host);`,
    )(
      { "127.0.0.1:5040": socket }, s.getServerAccessToken, s.removeServerAccessToken,
      { current: session ? { "127.0.0.1:5040": {} } : {} }, { current: { "127.0.0.1:5040": { token: "invite" } } }, nickname,
      s.setServerConnectionStatus, s.retryNow, s.replayReconnect, s.hasSession, "127.0.0.1:5040",
    );
    return s.calls;
  };

  const up = fakeSocket({ connected: true });
  assert.equal(run(up, true).retry.length, 0, "Reconnect on a connected socket retried it");
  await settle();
  assert.deepEqual(up.emitted, ["server:details", "members:fetch"], "Reconnect on a connected socket stopped asking for the server's state");

  const back = fakeSocket();
  const withSession = run(back, true);
  assert.equal(withSession.retry.length, 1, "Reconnect did not go through retryNow");
  withSession.retry[0].onConnect(false);
  await settle();
  assert.equal(withSession.replay.length, 1, "Reconnect brought a socket with a session back without the reconnect handling");
  assert.deepEqual(back.emitted, [], "Reconnect asked for the state again on top of the reconnect handling");

  const lost = fakeSocket();
  const noSession = run(lost, false);
  noSession.retry[0].onConnect(false);
  await settle();
  assert.equal(noSession.replay.length, 0);
  assert.deepEqual(lost.emitted, ["server:join"], "Reconnect without a session stopped joining again");
  assert.equal(noSession.removedToken, 1);
}

/* ── the handling a replay runs ───────────────────────────────────────────── */
{
  const handler = bodyOf(hook, 'socket.io.on("reconnect", () =>', HOOK);
  assert.match(handler, /dispatchEvent\(new CustomEvent\("server_socket_reconnected"/, "socket.io's reconnect handler no longer tells voice, so replaying it does not either");
  assert.match(handler, /emit\("voice:state:update", voiceSelfStateRef\.current\)/, "socket.io's reconnect handler no longer re-sends voice state");
  assert.match(hook, /railEntriesJustStarted\(lastSeen \?\? new Map\(\), states, serversRef\.current\)/, "the trigger matches hosted servers some other way than the rail does");
}

console.log("hosted server reconnect: tried the moment it comes up, once per start, and never joined again for it");
