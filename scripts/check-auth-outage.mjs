/* eslint-env node */

// An outage must not end anybody's session. Only a rejected grant clears the
// tokens; everything else keeps them and retries. GRYT-1104, GRYT-1178.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { retryDelayMs, startSignInRetry } from "../src/lib/signInRetry.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTH = "src/packages/common/src/auth/electron-auth.ts";
const KC = "src/packages/common/src/auth/keycloak.ts";
const HOOK = "src/packages/common/src/hooks/useAccount.tsx";
const auth = readFileSync(join(root, AUTH), "utf8");
const kc = readFileSync(join(root, KC), "utf8");
const hook = readFileSync(join(root, HOOK), "utf8");

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

assert.match(
  kc,
  /import \{ retryDelayMs[^}]*\} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/signInRetry'/,
  `${KC} no longer backs off with the retryDelayMs tested here`,
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

/* ── a launch that couldn't reach accounts tries again later ──────────────── */

/** Runs the retry against scripted answers, with timers that fire on demand. */
async function runRetry(answers) {
  const timers = [];
  const finished = [];
  let calls = 0;
  const stop = startSignInRetry({
    attempt: async () => {
      const next = answers[Math.min(calls++, answers.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    },
    onFinished: (result) => finished.push(result),
    delayMs: (failures) => failures * 1000,
    schedule: (run, ms) => {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => (timer.cancelled = true);
    },
  });
  const tick = async () => {
    await new Promise((r) => setImmediate(r));
    const due = timers.find((t) => !t.cancelled && !t.fired);
    if (due) {
      due.fired = true;
      due.run();
      await new Promise((r) => setImmediate(r));
    }
    return due;
  };
  return { timers, finished, stop, tick, calls: () => calls };
}

const quiet = console.warn;
const loud = console.log;
console.warn = () => {};
console.log = () => {};
try {
  {
    const r = await runRetry(["unavailable", new Error("Failed to fetch"), "signed-in"]);
    while (await r.tick());
    assert.deepEqual(r.finished, ["signed-in"], "a session that came back was not restored");
    assert.equal(r.calls(), 3, "the retry did not keep going through a network error");
    assert.deepEqual(r.timers.map((t) => t.ms), [1000, 2000], "the retry does not back off between tries");
  }
  {
    const r = await runRetry(["unavailable", "signed-out", "signed-in"]);
    while (await r.tick());
    assert.deepEqual(r.finished, ["signed-out"], "a rejected grant did not end the retry");
    assert.equal(r.calls(), 2, "the retry kept going after a rejected grant");
  }
  {
    const r = await runRetry(["signed-in"]);
    while (await r.tick());
    assert.equal(r.calls(), 1, "the retry kept going after signing in");
    assert.equal(r.timers.length, 0, "a signed-in retry left a timer behind");
  }
  {
    const r = await runRetry(["unavailable"]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(r.timers.length, 1, "a failed try did not schedule another");
    r.stop();
    assert.equal(r.timers.at(-1).cancelled, true, "stopping the retry left its timer running");
    while (await r.tick());
    assert.equal(r.calls(), 1, "the retry ran again after it was stopped");
    assert.deepEqual(r.finished, [], "a stopped retry still reported an answer");
  }
  {
    /* Stopped mid-try, as when somebody presses Sign in while one is out. */
    let answer;
    const finished = [];
    let scheduled = 0;
    const stop = startSignInRetry({
      attempt: () => new Promise((resolve) => (answer = resolve)),
      onFinished: (result) => finished.push(result),
      schedule: () => {
        scheduled += 1;
        return () => {};
      },
    });
    stop();
    answer("unavailable");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(scheduled, 0, "a retry stopped mid-try scheduled another anyway");
    assert.deepEqual(finished, [], "a retry stopped mid-try still reported an answer");
  }
} finally {
  console.warn = quiet;
  console.log = loud;
}

/* The attempt itself. It may only end the session where refreshTokens already would. */
const retry = block(kc, "export async function retrySignIn(): Promise<SignInAttempt> {", "retrySignIn");
assert.ok(!/clearStoredTokens|clearToken\(/.test(retry), `${KC} retrySignIn clears tokens itself`);
assert.ok(
  !/\.login\(|startLogin|electronLogin|electronRegister|openExternal|onLoad: 'login-required'/.test(retry),
  `${KC} retrySignIn can open a login page nobody asked for`,
);
assert.match(
  retry,
  /await refreshTokens\(stored\.refresh_token\);\s*\} catch \(e\) \{[\s\S]{0,120}?return e instanceof RefreshRejectedError \? "signed-out" : "unavailable";/,
  `${KC} retrySignIn gives up on a refresh that failed for a reason other than a rejected grant`,
);
assert.match(retry, /if \(!stored\) return "signed-out";/, `${KC} retrySignIn retries with no tokens to retry with`);
assert.match(retry, /initKeycloakForBrowser\(true\)/, `${KC} retrySignIn on the web can redirect the page`);

const browserInit = block(
  kc,
  "async function initKeycloakForBrowser(silentOnly = false): Promise<KeycloakInitResult> {",
  "initKeycloakForBrowser",
);
assert.match(
  browserInit,
  /silentOnly \? \{ silentCheckSsoFallback: false \}/,
  `${KC} silentOnly no longer stops keycloak-js falling back to a redirect`,
);
assert.match(
  browserInit,
  /\.catch\(\(err\) => \{[\s\S]{0,160}?unreachable = true;/,
  `${KC} a timed-out silent check reads as no session, so the web retry gives up during the outage`,
);

/* And the hook starts it only for a launch that failed, and never after a sign-out. */
const effect = hook.slice(hook.indexOf("useEffect(() => {\n    if (isSignedIn !== false"));
assert.ok(effect.length < hook.length, `${HOOK} no longer retries sign-in after a failed launch`);
assert.match(effect, /if \(stop \|\| retryDone\.current \|\| !accountsCameBack\(\)\) return;/, `${HOOK} retries before accounts are back`);
assert.match(effect, /startSignInRetry\(\{\s*attempt: retrySignIn,/, `${HOOK} does not retry with retrySignIn`);
assert.match(effect, /subscribeLaunchTrouble\(start\)/, `${HOOK} never hears that accounts came back`);
const logout = block(hook, "async function logout() {", "logout");
assert.ok(
  logout.indexOf("retryDone.current = true") >= 0 &&
    logout.indexOf("retryDone.current = true") < logout.indexOf("setIsSignedIn(false)"),
  `${HOOK} a retry can sign somebody back in after they signed out`,
);

console.log(
  `auth outage: ok, only a rejected grant clears tokens, ${attempts} attempts over an hour of downtime, sign-in retried once accounts are back`,
);
