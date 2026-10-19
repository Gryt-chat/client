// A dead server used to be retried every five seconds for as long as the app was
// open, and the toast saying so never went away. GRYT-1137.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = "src/packages/socket/src/hooks/useSockets.ts";
const TOASTS = "src/packages/socket/src/components/connectionToasts.tsx";
const hook = readFileSync(join(root, HOOK), "utf8");
const toasts = readFileSync(join(root, TOASTS), "utf8");

/** A declaration's body, from its brace to the one that closes it. */
function bodyOf(text: string, signature: string, where: string) {
  const at = text.indexOf(signature);
  assert.notEqual(at, -1, `${where} no longer has "${signature}". Move this check with it.`);
  const start = text.indexOf("{", at + signature.length);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after "${signature}" in ${where}`);
}

function constant(text: string, name: string, where: string) {
  const found = text.match(new RegExp(`const ${name}(?::[^=]+)? = ([0-9_]+)`));
  assert.ok(found, `${where} no longer declares ${name}. Move this check with it.`);
  return Number(found[1].replace(/_/g, ""));
}

// The attempts are capped, and the cap is a real number of tries.
{
  const attempts = constant(hook, "RECONNECT_ATTEMPTS", HOOK);
  const delayMax = constant(hook, "RECONNECT_DELAY_MAX_MS", HOOK);
  assert.ok(
    Number.isFinite(attempts) && attempts > 0,
    "the reconnect attempts are not capped, so a dead server is retried forever",
  );
  assert.ok(attempts >= 5, `${attempts} attempts gives up on a brief outage`);
  assert.ok(attempts <= 40, `${attempts} attempts is most of an hour of retrying`);

  // Roughly how long the app keeps trying, taking every attempt at the cap.
  const worst = (attempts * delayMax) / 1000;
  assert.ok(worst >= 60, `giving up after about ${worst}s does not cover a server restart`);
  assert.ok(worst <= 600, `about ${worst}s of retrying is too long to call it dead`);

  assert.ok(
    hook.includes("reconnectionAttempts: RECONNECT_ATTEMPTS"),
    "the cap is declared but never handed to socket.io",
  );
  assert.ok(
    hook.includes("reconnectionDelayMax: RECONNECT_DELAY_MAX_MS"),
    "the delay cap is declared but never handed to socket.io",
  );
}

/* A blip raises no toast: the rail's ring and the line under the server name say it
   (GRYT-1751). Giving up still does, since nothing else tells a server you aren't on. */
{
  assert.ok(!toasts.includes("showReconnectingToast"), "the reconnecting toast is back, on top of the ring and the header line");
  assert.ok(
    bodyOf(hook, 'socket.io.on("reconnect_failed"', HOOK).includes("showReconnectGaveUpToast"),
    "giving up no longer says so",
  );
}

/* Who gets asked to try again when the app comes back or the network returns.
   socket.io leaves `active` true after `reconnect_failed`. GRYT-1254. */
{
  const body = bodyOf(hook, "const retryGaveUp = ", HOOK);
  assert.ok(
    !/socket\.active/.test(body),
    "retryGaveUp reads socket.active again, which is true for a socket that gave up as well as one still trying",
  );
  assert.ok(
    hook.includes("gaveUpRef.current.add(host)"),
    "nothing records the host when socket.io gives up, so retryGaveUp has no way to know",
  );
  assert.ok(
    bodyOf(hook, 'socket.io.on("reconnect_failed"', HOOK).includes("gaveUpRef.current.add(host)"),
    "the host is recorded somewhere other than the reconnect_failed handler",
  );

  type Socket = { connected?: boolean; active?: boolean; reconnection?: boolean } | null;
  const run = (entries: [string, Socket][], gaveUpHosts: string[]) => {
    const reconnected: string[] = [];
    const marked: Record<string, string>[] = [];
    const gaveUp = new Set(gaveUpHosts);
    new Function(
      "sockets",
      "gaveUp",
      "setServerConnectionStatus",
      `return (() => ${body})();`,
    )(
      Object.fromEntries(
        entries.map(([host, s]) => [
          host,
          s && {
            connected: s.connected ?? false,
            active: s.active ?? false,
            io: { opts: { reconnection: s.reconnection ?? true } },
            connect: () => reconnected.push(host),
          },
        ]),
      ),
      gaveUp,
      (fn: (status: Record<string, string>) => Record<string, string>) => marked.push(fn({})),
    );
    return { reconnected, marked, gaveUp };
  };

  /* Every socket here is `active`, the way socket.io leaves them: the one that
     gave up, the one still working through its attempts, and the connected one. */
  const { reconnected, marked, gaveUp } = run(
    [
      ["gaveup.example", { connected: false, active: true }],
      ["connected.example", { connected: true, active: true }],
      ["stilltrying.example", { connected: false, active: true }],
      ["refused.example", { connected: false, active: true, reconnection: false }],
      ["gone.example", null],
    ],
    ["gaveup.example", "connected.example", "refused.example"],
  );

  assert.deepEqual(
    reconnected,
    ["gaveup.example"],
    "the wrong sockets are reconnected: a connected, still-trying, refused or missing one",
  );
  assert.deepEqual(
    marked.map((m) => Object.keys(m)[0]),
    ["gaveup.example"],
    "the rail is not told the server is being tried again",
  );
  assert.equal(marked[0]["gaveup.example"], "connecting");
  assert.ok(
    !gaveUp.has("gaveup.example"),
    "the host stays marked as given up while it is trying again, so the next focus reconnects it on top",
  );

  // Nothing marked means nothing to retry, however many sockets are down.
  const quiet = run([["stilltrying.example", { connected: false, active: true }]], []);
  assert.deepEqual(quiet.reconnected, [], "a socket nobody said had given up was reconnected anyway");
}

console.log("reconnect limit: ok, capped, quiet until it gives up, and only a socket that gave up is retried");
