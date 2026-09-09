/* eslint-env node */

// An outage must not end anybody's session. Only a rejected grant clears the
// tokens; everything else keeps them and retries. GRYT-1104.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTH = "src/packages/common/src/auth/electron-auth.ts";
const KC = "src/packages/common/src/auth/keycloak.ts";
const auth = readFileSync(join(root, AUTH), "utf8");
const kc = readFileSync(join(root, KC), "utf8");

/** Everything from `opener` to the brace that closes the block it opens. */
function block(text, opener, what) {
  const at = text.indexOf(opener);
  assert.ok(at >= 0, `no longer has ${what}`);
  const start = at + opener.length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${what}`);
}

/* ── which answers actually end a session ────────────────────────────────── */

const isGrantRejected = new Function(
  "status", "body",
  // One cast, which only tells TypeScript what JSON.parse gave back.
  block(auth, "function isGrantRejected(status: number, body: string): boolean {", "isGrantRejected")
    .slice(1, -1)
    .replace(" as { error?: string }", ""),
);

// The grant is over. These are the only two that may cost somebody their session.
assert.equal(isGrantRejected(401, ""), true, "a 401 is not treated as a dead grant");
assert.equal(
  isGrantRejected(400, JSON.stringify({ error: "invalid_grant" })),
  true,
  "invalid_grant is not treated as a dead grant",
);

// Ours, not theirs. Every one of these used to sign the person out for good.
for (const [status, body] of [
  [500, "internal error"],
  [502, "<html>Bad Gateway</html>"],
  [503, "Service Unavailable"],
  [504, "Gateway Timeout"],
  [429, JSON.stringify({ error: "too_many_requests" })],
  [408, ""],
  [520, "<html>Cloudflare</html>"],
  [400, JSON.stringify({ error: "temporarily_unavailable" })],
  [400, "<html>Error 1033</html>"],
]) {
  assert.equal(
    isGrantRejected(status, body),
    false,
    `a ${status} answering ${JSON.stringify(body).slice(0, 30)} would clear the tokens and end the session`,
  );
}

/* ── and the refresh only clears on the first kind ───────────────────────── */

const refresh = block(
  auth,
  "export async function refreshTokens(\n  refreshToken: string,\n): Promise<ElectronTokens> {",
  "refreshTokens",
);
const guarded = refresh.slice(refresh.indexOf("if (!res.ok)"), refresh.indexOf("const data ="));
assert.match(
  guarded,
  /if \(isGrantRejected\([^)]*\)\) \{\s*clearStoredTokens\(\);/,
  `${AUTH} clears the tokens outside the rejected-grant branch`,
);
assert.equal(
  (guarded.match(/clearStoredTokens\(\)/g) ?? []).length,
  1,
  `${AUTH} clears the tokens more than once on a failed refresh`,
);

/* ── the retry backs off rather than hammering ───────────────────────────── */

const retryDelayMs = new Function(
  "failures",
  block(kc, "function retryDelayMs(failures: number): number {", "retryDelayMs").slice(1, -1),
);

// Bounds, not sampled maxima: past the cap two attempts draw the same range,
// so comparing their largest samples is a coin toss.
for (const attempt of [1, 2, 3, 4, 5, 6, 10]) {
  const base = Math.min(30_000 * 2 ** (attempt - 1), 300_000);
  const samples = Array.from({ length: 400 }, () => retryDelayMs(attempt));

  for (const wait of samples) {
    assert.ok(
      wait >= base * 0.75 - 1 && wait <= base * 1.25 + 1,
      `attempt ${attempt} waited ${Math.round(wait)}ms, outside the jittered ${base}ms it should back off to`,
    );
  }
  assert.ok(
    Math.max(...samples) - Math.min(...samples) > base * 0.1,
    `attempt ${attempt} has no jitter, so every client retries at the same instant`,
  );
}

// And it really does grow, rather than sitting at the first delay.
assert.ok(
  retryDelayMs(5) > retryDelayMs(1) * 2,
  "the delay does not grow with repeated failures",
);

/* An hour of downtime, to show it is not a hot loop. */
let elapsed = 0;
let attempts = 0;
while (elapsed < 3_600_000) {
  attempts += 1;
  elapsed += retryDelayMs(attempts);
}
assert.ok(
  attempts <= 20,
  `an hour of downtime costs ${attempts} refresh attempts per client, which is a hot loop`,
);

// A rejected grant stops the loop rather than backing off forever.
assert.match(
  kc,
  /if \(e instanceof RefreshRejectedError\)[\s\S]{0,200}?return;/,
  `${KC} retries a grant that has already been rejected`,
);

console.log(
  `auth outage: ok, only a rejected grant clears tokens, ${attempts} attempts over an hour of downtime`,
);
