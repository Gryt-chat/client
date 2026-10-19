/* eslint-env node */

// The wait for a server's identity proof outlived its connection, so a restart soon after
// connecting refused a pinned server as proof_withdrawn and blocked it for good. GRYT-1497.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "src/packages/socket/src/utils/serverAuth.ts"), "utf8");
const IDENTITY_TIMEOUT_MS = Number(source.match(/const IDENTITY_TIMEOUT_MS = (\d+);/)?.[1]);
assert.ok(IDENTITY_TIMEOUT_MS > 0, "serverAuth.ts no longer declares IDENTITY_TIMEOUT_MS as a number");

// serverAuth.ts's own relative imports, resolved from where it sits rather than from here.
const resolveFromGuard = (spec: string) =>
  spec.startsWith("./") ? new URL(`../src/packages/socket/src/utils/${spec.slice(2)}.ts`, import.meta.url).href : import.meta.resolve(spec);

// Only what the guard asks of @/common. A missing proof is a refusal, as it is for a pinned server.
const moduleUrl = (text: string) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const COMMON = moduleUrl(`
  let n = 0;
  export const createClientNonce = () => "nonce-" + ++n;
  export const listBlocked = () => [];
  export const forgetServerFileAccess = () => {};
  export const restoreServerFileToken = () => {};
  export const applyServerProofDecision = (host, decision) => globalThis.__decisions.push(decision);
  export const evaluateServerProof = async ({ proof, sentNonce }) =>
    !proof
      ? { action: "block", failure: { reason: "proof_withdrawn", detail: "", expectedKeyId: "k" } }
      : proof === sentNonce
        ? { action: "trusted", keyId: "k" }
        : { action: "block", failure: { reason: "nonce_mismatch", detail: "" } };
`);
const compiled = ts
  .transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
  .outputText.replace(/(\bimport\s[^;]*?\bfrom\s*)"([^"]+)"/g, (_: string, head: string, spec: string) =>
    `${head}"${spec === "@/common" ? COMMON : resolveFromGuard(spec)}"`);

// A clock the check turns, so five seconds of silence take no time at all.
let now = 0;
let timers: { id: number; at: number; fn: () => void }[] = [];
let nextId = 0;
Object.assign(globalThis, {
  setTimeout: (fn: () => void, ms: number) => {
    const id = ++nextId;
    timers.push({ id, at: now + ms, fn });
    return id;
  },
  clearTimeout: (id: number) => {
    timers = timers.filter((t) => t.id !== id);
  },
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function advance(ms: number) {
  const until = now + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers = timers.filter((t) => t !== due);
    now = due.at;
    due.fn();
    await settle();
  }
  now = until;
  await settle();
}

/** What the stubbed @/common records, read back through globalThis. */
type Decision = { action: string; failure?: { reason: string } };
const shared = globalThis as typeof globalThis & { __decisions: Decision[] };
shared.__decisions = [];
const { guardSocket } = await import(moduleUrl(compiled));

/** A socket.io client as far as the guard can tell. `answer` plays the server. */
function fakeSocket() {
  type Payload = string | { clientNonce?: string; proof?: string };
  const listeners = new Map<string, ((payload?: Payload) => void)[]>();
  const sent: [string, ...Payload[]][] = [];
  const socket = {
    io: { opts: { reconnection: true } },
    disconnected: false,
    on: (event: string, cb: (payload?: Payload) => void) => listeners.set(event, [...(listeners.get(event) ?? []), cb]),
    emit: (event: string, ...args: Payload[]) => {
      sent.push([event, ...args]);
      return socket;
    },
    disconnect: () => {
      socket.disconnected = true;
    },
  };
  const fire = (event: string, payload?: Payload) => {
    for (const cb of listeners.get(event) ?? []) cb(payload);
  };
  const lastNonce = () => {
    const identify = sent.filter(([e]) => e === "server:identify").at(-1)?.[1];
    return typeof identify === "object" ? identify.clientNonce : undefined;
  };
  const answer = () => fire("server:identity", { proof: lastNonce() });
  return { socket, sent, fire, answer };
}

const silent = () => {};
console.error = silent;
console.log = silent;

// A reconnect soon after the first connect is not refused by the first connection's wait.
{
  shared.__decisions = [];
  const { socket, fire, answer } = fakeSocket();
  let refused = null as Decision | null;
  guardSocket(socket, "h", (d: Decision) => (refused = d));
  fire("connect");
  answer();
  await advance(1_000);
  fire("disconnect", "transport close");
  await advance(2_000);
  fire("connect");
  await advance(IDENTITY_TIMEOUT_MS - 1_000);
  assert.equal(refused, null, "the first connection's wait ran out on the second one, which had not had its five seconds");
  answer();
  await advance(IDENTITY_TIMEOUT_MS * 2);
  assert.equal(refused, null, "a server that answered on its reconnect was refused");
  assert.equal(socket.disconnected, false);
  assert.ok(shared.__decisions.every((d) => d.action === "trusted"), `decisions: ${JSON.stringify(shared.__decisions)}`);
}

// A connection that drops before the answer, with nothing back yet, refuses nobody.
{
  shared.__decisions = [];
  const { socket, fire } = fakeSocket();
  let refused = null as Decision | null;
  guardSocket(socket, "h", (d: Decision) => (refused = d));
  fire("connect");
  await advance(1_000);
  fire("disconnect", "transport close");
  await advance(IDENTITY_TIMEOUT_MS * 3);
  assert.equal(refused, null, "a wait outlived the connection it was for and refused the server");
  assert.equal(shared.__decisions.length, 0);
}

// A server that connects and stays silent is still refused: that is what the wait is for.
{
  shared.__decisions = [];
  const { socket, fire } = fakeSocket();
  let refused = null as Decision | null;
  guardSocket(socket, "h", (d: Decision) => (refused = d));
  fire("connect");
  await advance(IDENTITY_TIMEOUT_MS - 1);
  assert.equal(refused?.action, undefined, "refused before the wait was over");
  await advance(1);
  assert.equal(refused?.failure?.reason, "proof_withdrawn", "a pinned server that never answered was let through");
  assert.equal(socket.io.opts.reconnection, false);
}

// The same, on a reconnect: its own silence is still caught.
{
  shared.__decisions = [];
  const { socket, fire, answer } = fakeSocket();
  let refused = null as Decision | null;
  guardSocket(socket, "h", (d: Decision) => (refused = d));
  fire("connect");
  answer();
  await advance(500);
  fire("disconnect", "transport close");
  fire("connect");
  await advance(IDENTITY_TIMEOUT_MS);
  assert.equal(refused?.failure?.reason, "proof_withdrawn", "a reconnect that never proved itself was let through");
}

process.stdout.write("identity timeout: each connection waits for its own answer\n");
