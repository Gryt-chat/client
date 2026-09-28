/* eslint-env node */

// Uploads, avatar sync, emoji and embeds sent the access token over HTTP to whatever answered,
// proved or not. Now a bearer request waits for the socket's identity proof. GRYT-1547.

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

// The network as the app would see it, taken before the gate wraps it.
const network = globalThis.fetch.bind(globalThis);

/** Enough XMLHttpRequest for the emoji uploads: open, a header, send, and error events. */
class FakeXhr extends EventTarget {
  open(method, url) {
    this.method = method;
    this.url = url;
    this.headers = {};
  }
  setRequestHeader(name, value) {
    this.headers[name] = value;
  }
  send(body) {
    network(this.url, { method: this.method, headers: this.headers, body }).then(
      (res) => {
        this.status = res.status;
        this.dispatchEvent(new Event("load"));
      },
      () => this.dispatchEvent(new Event("error")),
    );
  }
}
globalThis.XMLHttpRequest = FakeXhr;

// serverAuth.ts's own relative imports, resolved from where it sits rather than from here.
const resolveFromGuard = (spec) =>
  spec.startsWith("./") ? new URL(`../src/packages/socket/src/utils/${spec.slice(2)}.ts`, import.meta.url).href : import.meta.resolve(spec);

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
    `${head}"${spec === "@/common" ? COMMON : resolveFromGuard(spec)}"`);
const { guardSocket } = await import(moduleUrl(compiled));
console.error = () => {};

// fetchServerInfo as shipped, from the add-server and invite dialogs. The stubs hand it a stored token.
const JOIN = "src/packages/settings/src/hooks/useServerJoin.ts";
const INFO_STUBS = {
  "@/common": moduleUrl(`
    export const getServerAccessToken = () => ${JSON.stringify("access-token-that-must-not-leak")};
    export const getServerHttpBase = (host, scheme) => (scheme ?? "http") + "://" + host;
    export const normalizeHost = (host) => host;
    export const normalizeCode = (code) => code;
    export const schemeFor = () => "http";
    export const otherScheme = (s) => (s === "http" ? "https" : "http");
    export const schemeOfUrl = (url) => new URL(url).protocol.slice(0, -1);
    export const rememberScheme = () => {};
    export const setServerAccessToken = () => {};
    export const setServerFileToken = () => {};
    export const setServerRefreshToken = () => {};
  `),
  "@/socket": moduleUrl("export const joinServerOnce = () => {};"),
  "../../../socket/src/hooks/useServerManagement": moduleUrl("export const useServerManagement = () => ({});"),
  "../serverId": moduleUrl("export const sameServer = () => false;"),
  "./useSettings": moduleUrl("export const useSettings = () => ({});"),
};
globalThis.window ??= globalThis;
const { fetchServerInfo } = await import(
  moduleUrl(
    ts
      .transpileModule(readFileSync(join(root, JOIN), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      })
      .outputText.replace(/(\bimport\s[^;]*?\bfrom\s*)"([^"]+)"/g, (_, head, spec) => `${head}"${INFO_STUBS[spec] ?? import.meta.resolve(spec)}"`),
  )
);

const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(require.resolve("engine.io-client"))("ws");

const TOKEN = "access-token-that-must-not-leak";
const BEARER = { Authorization: `Bearer ${TOKEN}` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A Gryt server on one port: socket.io over WebSocket, and HTTP that writes down every request. */
function fakeServer() {
  let http = null;
  let wss = null;
  const live = new Set();
  const server = {
    proves: true,
    /** Every HTTP request, in order, with its Authorization header. */
    requests: [],
    /** When each identity answer went out, to put the HTTP requests against. */
    proofsAt: [],
    url: "",
    async up() {
      http = createServer((req, res) => {
        server.requests.push({ path: req.url, auth: req.headers.authorization ?? null, at: performance.now() });
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
      wss = new WebSocketServer({ server: http });
      wss.on("connection", (ws) => {
        live.add(ws);
        ws.on("close", () => live.delete(ws));
        const proves = server.proves;
        ws.send(`0${JSON.stringify({ sid: "e", upgrades: [], pingInterval: 60_000, pingTimeout: 60_000, maxPayload: 1_000_000 })}`);
        ws.on("message", (data) => {
          const text = String(data);
          if (text.startsWith("40")) return ws.send(`40${JSON.stringify({ sid: "s" })}`);
          if (!text.startsWith("42")) return;
          const [event, payload] = JSON.parse(text.slice(2));
          if (event === "server:identify" && proves) {
            server.proofsAt.push(performance.now());
            ws.send(`42${JSON.stringify(["server:identity", { proof: payload.clientNonce }])}`);
          }
        });
      });
      await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
      server.host = `127.0.0.1:${http.address().port}`;
      server.url = `http://${server.host}`;
    },
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

function connect(server) {
  const socket = io(server.url, { transports: ["websocket"], forceNew: true, reconnectionDelay: 50, reconnectionDelayMax: 50, randomizationFactor: 0 });
  const seen = { refused: null };
  guardSocket(socket, server.host, (decision) => (seen.refused = decision));
  return { socket, seen };
}

async function until(what, test, ms = 3_000) {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

/** What the emoji upload does, reduced to whether it went or failed. */
function xhrUpload(url) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.addEventListener("load", () => resolve("sent"));
    xhr.addEventListener("error", () => resolve("failed"));
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${TOKEN}`);
    xhr.send("x");
  });
}

const withToken = (server) => server.requests.filter((r) => r.auth?.includes(TOKEN));
const servers = [];
const sockets = [];
async function started(proves = true) {
  const server = fakeServer();
  server.proves = proves;
  servers.push(server);
  await server.up();
  return server;
}

try {
  // A server that proves itself: a bearer request made before the proof goes, after it.
  {
    const server = await started();
    const { socket, seen } = connect(server);
    sockets.push(socket);
    const early = fetch(`${server.url}/api/uploads`, { method: "POST", headers: BEARER });
    const earlyXhr = xhrUpload(`${server.url}/api/emojis`);
    assert.equal((await early).status, 200);
    assert.equal(await earlyXhr, "sent");
    assert.equal(withToken(server).length, 2);
    for (const r of withToken(server)) {
      assert.ok(r.at > server.proofsAt[0], `${r.path} carried the token before the server had proved itself`);
    }
    assert.equal(seen.refused, null);
  }

  // Never proves itself: no request with the token reaches it, and each one fails instead.
  {
    const server = await started(false);
    const { socket, seen } = connect(server);
    sockets.push(socket);
    const beforeRefusal = fetch(`${server.url}/api/uploads`, { method: "POST", headers: BEARER });
    const beforeRefusalXhr = xhrUpload(`${server.url}/api/emojis`);
    await assert.rejects(beforeRefusal, /has not proved its identity/, "a bearer fetch to a server that never proved itself did not fail");
    assert.equal(await beforeRefusalXhr, "failed", "a bearer upload to a server that never proved itself did not fail");
    assert.ok(seen.refused, "the guard never refused it, so nothing was tested");
    await assert.rejects(fetch(`${server.url}/api/me`, { headers: new Headers(BEARER) }), /has not proved its identity/);
    await assert.rejects(fetch(new Request(`${server.url}/api/me`, { headers: BEARER })), /has not proved its identity/);

    // Nothing without a token waits: /info and the like still answer.
    assert.equal((await fetch(`${server.url}/info`)).status, 200);
    assert.deepEqual(withToken(server), [], `the token reached a server that never proved itself: ${JSON.stringify(server.requests)}`);
  }

  // Proved once, then whatever answers after the drop never proves itself.
  {
    const server = await started();
    const { socket, seen } = connect(server);
    sockets.push(socket);
    assert.equal((await fetch(`${server.url}/api/uploads`, { method: "POST", headers: BEARER })).status, 200);
    const sentBefore = withToken(server).length;

    server.proves = false;
    server.drop();
    await until("the drop", () => !socket.connected);
    const whileDown = fetch(`${server.url}/api/uploads`, { method: "POST", headers: BEARER });
    const whileDownXhr = xhrUpload(`${server.url}/api/emojis`);
    await assert.rejects(whileDown, /has not proved its identity/);
    assert.equal(await whileDownXhr, "failed");
    assert.ok(seen.refused, "the reconnect was never refused, so nothing was tested");
    assert.equal(withToken(server).length, sentBefore, "a bearer request went to the unproved reconnect");
  }

  // /info from the dialogs goes straight through a host that has not proved itself yet, with no token.
  {
    const server = await started(false);
    const { socket, seen } = connect(server);
    sockets.push(socket);
    const asked = performance.now();
    const result = await fetchServerInfo(server.host);
    assert.equal(result.kind, "info", `the dialogs' /info did not get an answer: ${JSON.stringify(result)}`);
    assert.equal(seen.refused, null, "/info waited for the identity check to end instead of going straight through");
    assert.ok(performance.now() - asked < WAIT_MS, "/info waited on the identity proof");
    const info = server.requests.filter((r) => r.path === "/info");
    assert.equal(info.length, 1);
    assert.equal(info[0].auth, null, "the dialogs' /info carried the token, which the server ignores");
  }

  // A host no guard looks after is none of the gate's business, token or not.
  {
    const server = await started(false);
    assert.equal((await fetch(`${server.url}/api/elsewhere`, { headers: BEARER })).status, 200);
    assert.equal(withToken(server).length, 1);
  }
} finally {
  for (const socket of sockets) socket.close();
  for (const server of servers) await server.down();
}

process.stdout.write("http proof gate: a request carrying the token only goes to a server that has proved itself\n");
