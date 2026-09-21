/* eslint-env node */

// A one-second drop greyed the server, spun the ring and raised two toasts. Now a
// drop that is back within the grace shows nothing; a longer one is announced. GRYT-1301.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { io } from "socket.io-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const HOOK = "src/packages/socket/src/hooks/useSockets.ts";
const hook = read(HOOK);

const { RECONNECT_GRACE_MS, watchReconnects } = await import("../src/packages/socket/src/utils/reconnectGrace.ts");
const { retryNow } = await import("../src/packages/socket/src/utils/retryNow.ts");

// What engine.io-client itself opens sockets with in Node, so it is here whenever the client is.
const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(require.resolve("engine.io-client"))("ws");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/* ── the real constant ─────────────────────────────────────────────────────── */

// socket.io's first retry is 0.5 to 1.5 seconds out, and the handshake comes after it.
assert.ok(RECONNECT_GRACE_MS >= 2_000, `${RECONNECT_GRACE_MS}ms is shorter than socket.io's first retry, so a blip is still shown`);
assert.ok(RECONNECT_GRACE_MS <= 5_000, `${RECONNECT_GRACE_MS}ms of nothing is too long for a server that is really gone`);

/* ── the real thing: socket.io-client against a server that drops it ───────── */

/** Enough engine.io and socket.io for a client to connect, on one port that can drop, close and reopen. */
function fakeServer() {
  let http = null;
  let wss = null;
  let port = 0;
  const live = new Set();
  const server = {
    get url() {
      return `http://127.0.0.1:${port}`;
    },
    async up() {
      http = createServer();
      wss = new WebSocketServer({ server: http });
      wss.on("connection", (ws) => {
        live.add(ws);
        ws.on("close", () => live.delete(ws));
        const open = { sid: `engine${live.size}`, upgrades: [], pingInterval: 60_000, pingTimeout: 60_000, maxPayload: 1_000_000 };
        ws.send(`0${JSON.stringify(open)}`);
        ws.on("message", (data) => {
          if (String(data).startsWith("40")) ws.send(`40${JSON.stringify({ sid: `socket${live.size}` })}`);
        });
      });
      await new Promise((resolve) => http.listen(port, "127.0.0.1", resolve));
      port = http.address().port;
    },
    /** The server stays up and the socket goes, as a tunnel blip looks from the server. */
    drop() {
      for (const ws of live) ws.terminate();
    },
    /** socket.io's own DISCONNECT packet: what `socket.disconnect(true)` on the server sends. */
    kick() {
      for (const ws of live) ws.send("41");
    },
    async down() {
      server.drop();
      await new Promise((resolve) => wss.close(resolve));
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
  return server;
}

const GRACE = 300;
const clients = [];
const servers = [];

/** A connected socket with the watch on it, and delays short enough for a check. */
async function watched() {
  const server = fakeServer();
  servers.push(server);
  await server.up();
  const socket = io(server.url, {
    transports: ["websocket"],
    forceNew: true,
    reconnectionDelay: 100,
    reconnectionDelayMax: 100,
    randomizationFactor: 0,
  });
  clients.push(socket);
  const seen = { reconnecting: 0, reconnected: [], closed: 0, at: {} };
  watchReconnects(socket, GRACE, {
    onReconnecting: () => {
      seen.reconnecting++;
      seen.at.reconnecting = Date.now();
    },
    onReconnected: (wasShown) => seen.reconnected.push(wasShown),
    onClosed: () => seen.closed++,
  });
  await next(socket, "connect", 3_000, "the first connection");
  return { server, socket, seen };
}

try {
  // A drop the first retry mends: nothing is shown, and nothing says it is back either.
  {
    const { server, socket, seen } = await watched();
    server.drop();
    await next(socket.io, "reconnect", 2_000, "the retry after a drop");
    await sleep(GRACE * 2);
    assert.equal(socket.connected, true);
    assert.equal(seen.reconnecting, 0, "a drop that was back in a moment was shown");
    assert.deepEqual(seen.reconnected, [false], "the return was announced for a drop that was never shown");
    assert.equal(seen.closed, 0);
  }

  // A server that stays away: shown once the grace is up, and its return is announced.
  {
    const { server, socket, seen } = await watched();
    const [dropped] = await Promise.all([next(socket, "disconnect", 2_000, "the drop").then(() => Date.now()), server.down()]);
    await sleep(GRACE * 3);
    assert.equal(seen.reconnecting, 1, `shown ${seen.reconnecting} times during an outage, not once`);
    const after = seen.at.reconnecting - dropped;
    assert.ok(after >= GRACE - 20, `shown ${after}ms after the drop, before the ${GRACE}ms grace was up`);
    assert.ok(after < GRACE + 200, `shown ${after}ms after the drop, well past the ${GRACE}ms grace`);
    assert.deepEqual(seen.reconnected, [], "the return was announced before the server was back");

    await server.up();
    await next(socket.io, "reconnect", 3_000, "the retry once the server is back");
    assert.deepEqual(seen.reconnected, [true], "the return of a drop that was shown was not announced");
    assert.equal(seen.reconnecting, 1, "shown again on the way back");
    assert.equal(seen.closed, 0);
  }

  // Brought back by a fresh open inside the grace, as a hosted server restarting is: still nothing.
  {
    const { server, socket, seen } = await watched();
    server.drop();
    await next(socket, "disconnect", 2_000, "the drop");
    retryNow(socket, () => {});
    await next(socket, "connect", 2_000, "the fresh open");
    await sleep(GRACE * 2);
    assert.equal(seen.reconnecting, 0, "a socket that was back by a fresh open was shown as reconnecting");
    assert.deepEqual(seen.reconnected, [], "a fresh open was taken for socket.io's own reconnect");
  }

  // Ended by the server, where socket.io does not retry: closed, not reconnecting, and not later either.
  {
    const { server, socket, seen } = await watched();
    server.kick();
    const [reason] = await next(socket, "disconnect", 2_000, "the server's disconnect");
    assert.equal(reason, "io server disconnect", "the fake server's kick is not what socket.io calls one");
    assert.equal(socket.active, false);
    assert.equal(seen.closed, 1, "a socket the server ended was not reported closed");
    await sleep(GRACE * 2);
    assert.equal(seen.reconnecting, 0, "a socket the server ended was shown as reconnecting");
    assert.deepEqual(seen.reconnected, []);
  }

  // Put down on purpose, the way a refused server is: closed, and the grace never fires.
  {
    const { socket, seen } = await watched();
    socket.io.opts.reconnection = false;
    socket.disconnect();
    assert.equal(seen.closed, 1, "a socket this app closed was not reported closed");
    await sleep(GRACE * 2);
    assert.equal(seen.reconnecting, 0, "a socket this app closed was shown as reconnecting");
  }

  // Left during the grace: the timer finds the socket put down and says nothing.
  {
    const { server, socket, seen } = await watched();
    server.drop();
    await next(socket, "disconnect", 2_000, "the drop");
    socket.removeAllListeners();
    socket.disconnect();
    await sleep(GRACE * 2);
    assert.equal(seen.reconnecting, 0, "a server left during the grace was shown as reconnecting afterwards");
    assert.equal(seen.closed, 0, "removeAllListeners left the watch's disconnect listener behind");
  }
} finally {
  for (const socket of clients) socket.disconnect();
  for (const server of servers) await server.down().catch(() => {});
}

/* ── and the hook uses it, for the toast as well as the status ─────────────── */

assert.ok(hook.includes("watchReconnects(socket, RECONNECT_GRACE_MS, {"), `${HOOK} no longer watches its sockets through watchReconnects`);
assert.ok(!/socket\.on\("disconnect"/.test(hook), `${HOOK} handles disconnect itself again, ahead of the grace`);
assert.ok(!/socket\.io\.on\("reconnect",/.test(hook), `${HOOK} handles reconnect itself again, so the toast ignores whether the drop was shown`);
assert.ok(hook.includes("if (wasShown) toast.success(`Reconnected to ${serverName}`"), "the Reconnected toast is raised for a drop nobody saw");
{
  const at = hook.indexOf("onReconnecting: () => {");
  assert.notEqual(at, -1, `${HOOK} has no onReconnecting. Move this check with it.`);
  const body = hook.slice(at, hook.indexOf("onReconnected", at));
  assert.ok(body.includes("'reconnecting'"), "onReconnecting does not set the status the rail greys on");
  assert.ok(body.includes("showReconnectingToast(toastId, serverName)"), "onReconnecting does not raise the toast");
}

console.log("reconnect grace: ok, a short drop shows nothing, a long one is announced once");
