/* eslint-env node */

// After the first proof the guard let go for good, so a reconnect sent session:restore and
// its access token to whatever answered, before it proved anything. GRYT-1541.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { io } from "socket.io-client";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/packages/socket/src/utils/serverAuth.ts"), "utf8");

// Only what the guard asks of @/common. A proof is good when it echoes the nonce it answers.
const moduleUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const COMMON = moduleUrl(`
  let n = 0;
  export const createClientNonce = () => "nonce-" + ++n;
  export const listBlocked = () => [];
  export const applyServerProofDecision = () => {};
  export const evaluateServerProof = async ({ proof, sentNonce }) =>
    proof && proof === sentNonce
      ? { action: "trusted", keyId: "k" }
      : { action: "block", failure: { reason: "proof_withdrawn", detail: "", expectedKeyId: "k" } };
`);
// The five-second wait, cut so the check does not sit through it. Everything else is as shipped.
const WAIT_MS = 400;
assert.match(source, /const IDENTITY_TIMEOUT_MS = \d+;/, "serverAuth.ts no longer declares IDENTITY_TIMEOUT_MS");
const compiled = ts
  .transpileModule(source.replace(/const IDENTITY_TIMEOUT_MS = \d+;/, `const IDENTITY_TIMEOUT_MS = ${WAIT_MS};`), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  .outputText.replace(/(\bimport\s[^;]*?\bfrom\s*)"([^"]+)"/g, (_, head, spec) =>
    `${head}"${spec === "@/common" ? COMMON : import.meta.resolve(spec)}"`);
const { guardSocket } = await import(moduleUrl(compiled));
console.error = () => {};

// What engine.io-client itself opens sockets with in Node, so it is here whenever the client is.
const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(require.resolve("engine.io-client"))("ws");

const TOKEN = "access-token-that-must-not-leak";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Enough engine.io and socket.io for a client to connect, on one port. `proves` says whether
 * it answers `server:identify`; every event it is sent is kept, per connection.
 */
function fakeServer() {
  let http = null;
  let wss = null;
  const live = new Set();
  const server = {
    proves: true,
    connections: [],
    url: "",
    async up() {
      http = createServer();
      wss = new WebSocketServer({ server: http });
      wss.on("connection", (ws) => {
        live.add(ws);
        ws.on("close", () => live.delete(ws));
        const heard = [];
        server.connections.push(heard);
        const proves = server.proves;
        ws.send(`0${JSON.stringify({ sid: `e${server.connections.length}`, upgrades: [], pingInterval: 60_000, pingTimeout: 60_000, maxPayload: 1_000_000 })}`);
        ws.on("message", (data) => {
          const text = String(data);
          if (text.startsWith("40")) return ws.send(`40${JSON.stringify({ sid: `s${server.connections.length}` })}`);
          if (!text.startsWith("42")) return;
          heard.push(text);
          const [event, payload] = JSON.parse(text.slice(2));
          if (event === "server:identify" && proves) {
            ws.send(`42${JSON.stringify(["server:identity", { proof: payload.clientNonce }])}`);
          }
        });
      });
      await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
      server.url = `http://127.0.0.1:${http.address().port}`;
    },
    /** The socket goes and the server stays, as a restart looks from the client once it is back. */
    drop() {
      for (const ws of live) ws.terminate();
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

/** The client's own shape: guarded, then session:restore with the token on every connect. */
async function client(server) {
  const socket = io(server.url, { transports: ["websocket"], forceNew: true, reconnectionDelay: 50, reconnectionDelayMax: 50, randomizationFactor: 0 });
  const seen = { refused: null, connects: 0 };
  guardSocket(socket, "h", (decision) => (seen.refused = decision));
  socket.on("connect", () => {
    seen.connects++;
    socket.emit("session:restore", { accessToken: TOKEN });
  });
  return { socket, seen };
}

async function until(what, test, ms = 3_000) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

const events = (heard) => heard.map((t) => JSON.parse(t.slice(2))[0]);
const leaked = (heard) => heard.filter((t) => t.includes(TOKEN));
const servers = [];
const sockets = [];

try {
  // A server that proves itself: the token goes, after the proof, on the first connection and the next.
  {
    const server = fakeServer();
    servers.push(server);
    await server.up();
    const { socket, seen } = await client(server);
    sockets.push(socket);
    await until("the first restore", () => leaked(server.connections[0] ?? []).length === 1);
    assert.deepEqual(events(server.connections[0]), ["server:identify", "session:restore"], "the token went before the proof");

    server.drop();
    await until("the reconnect's restore", () => leaked(server.connections[1] ?? []).length === 1);
    assert.deepEqual(events(server.connections[1]), ["server:identify", "session:restore"], "on a reconnect the token went before the proof");
    assert.equal(seen.refused, null);
  }

  // Proved once, then whatever answers after the drop never proves itself: the token never reaches it.
  {
    const server = fakeServer();
    servers.push(server);
    await server.up();
    const { socket, seen } = await client(server);
    sockets.push(socket);
    await until("the first restore", () => leaked(server.connections[0] ?? []).length === 1);

    server.proves = false;
    server.drop();
    await until("the drop", () => !socket.connected);
    // Sent while it was down, which socket.io keeps and flushes the moment it is back.
    socket.emit("chat:send", { accessToken: TOKEN, text: "typed while it was down" });
    await until("the refusal", () => seen.refused !== null, WAIT_MS * 10);
    await sleep(WAIT_MS);

    assert.ok(server.connections.length >= 2, "the client never reconnected, so nothing was tested");
    for (const heard of server.connections.slice(1)) {
      assert.deepEqual(leaked(heard), [], `the token reached a server that never proved itself: ${heard.join(" ")}`);
      assert.deepEqual(events(heard), ["server:identify"], "something other than the identity request went to an unproved server");
    }
    assert.equal(seen.refused.failure.reason, "proof_withdrawn");
    assert.equal(socket.connected, false, "the refused socket is still open");
  }

  // Never proved at all, from the first connection: nothing but the identity request.
  {
    const server = fakeServer();
    servers.push(server);
    server.proves = false;
    await server.up();
    const { socket, seen } = await client(server);
    sockets.push(socket);
    await until("the refusal", () => seen.refused !== null, WAIT_MS * 10);
    assert.deepEqual(server.connections.flatMap(events), ["server:identify"]);
  }
} finally {
  for (const socket of sockets) socket.close();
  for (const server of servers) await server.down();
}

process.stdout.write("hold until proven: the token only goes to a server that has proved itself, on every connection\n");
