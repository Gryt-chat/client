/* eslint-env node */

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
function bodyOf(text, signature, where) {
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

function constant(text, name, where) {
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

// The reconnecting toast goes away on its own, and can be sent away sooner.
{
  const ms = constant(toasts, "RECONNECT_TOAST_MS", TOASTS);
  assert.ok(Number.isFinite(ms) && ms > 0, "the reconnecting toast never expires");
  assert.ok(ms >= 3_000 && ms <= 15_000, `${ms}ms is not a readable toast`);

  const raise = bodyOf(toasts, "export function showReconnectingToast", TOASTS);
  assert.ok(raise.includes("duration: RECONNECT_TOAST_MS"), "the toast is raised without its duration");
  assert.ok(raise.includes("DismissibleToast"), "the toast has no way to dismiss it");
  assert.ok(raise.includes("toast.dismiss(toastId)"), "the close button dismisses something other than this toast");
}

/* Who gets asked to try again when the app comes back or the network returns.
   Reconnecting a socket that was put down on purpose undoes the refusal. */
{
  const body = bodyOf(hook, "const retryGaveUp = ", HOOK);
  const run = (entries) => {
    const reconnected = [];
    const marked = [];
    new Function(
      "sockets",
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
      (fn) => marked.push(fn({})),
    );
    return { reconnected, marked };
  };

  const { reconnected, marked } = run([
    ["gaveup.example", { connected: false, active: false }],
    ["connected.example", { connected: true, active: true }],
    ["stilltrying.example", { connected: false, active: true }],
    ["refused.example", { connected: false, active: false, reconnection: false }],
    ["gone.example", null],
  ]);

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
}

console.log("reconnect limit: ok, capped, dismissable, and a refused server stays down");
