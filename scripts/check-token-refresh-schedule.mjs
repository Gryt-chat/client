/* eslint-env node */

// Every server's token used to be refreshed in the same tick on one four-minute
// timer. Each server now has its own, planned from its token. GRYT-1140, GRYT-1143.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  MIN_REFRESH_DELAY_MS,
  REFRESH_LEAD_MS,
  REFRESH_SPREAD_MS,
  RETRY_DELAY_MS,
  SOON_SPREAD_MS,
  hostOffsetMs,
  refreshDelayMs,
} = await import("../src/packages/socket/src/utils/tokenRefreshSchedule.ts");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = "src/packages/socket/src/hooks/useSockets.ts";
const MANAGER = "src/packages/socket/src/utils/tokenManager.ts";
const hook = readFileSync(join(root, HOOK), "utf8");
const manager = readFileSync(join(root, MANAGER), "utf8");

const NOW = 1_800_000_000_000;
const FIFTEEN_MIN = 15 * 60_000;
const HOSTS = ["ws1.sivert.io", "pp.sivert.io", "community.gryt.chat", "192.168.50.137:5000", "localhost:5003"];

// ── a fresh token is not refreshed for minutes ─────────────────────

for (const host of HOSTS) {
  const delay = refreshDelayMs(host, NOW + FIFTEEN_MIN, NOW);
  assert.ok(delay >= FIFTEEN_MIN - REFRESH_LEAD_MS - REFRESH_SPREAD_MS, `${host} refreshes a fresh token after ${delay}ms`);
  assert.ok(delay <= FIFTEEN_MIN - REFRESH_LEAD_MS, `${host} waits past its lead: ${delay}ms`);
}

// ── but always before a send would have to refresh it first ────────

// shouldRefreshToken refreshes inline under this, and every send waits on it.
const inline = manager.match(/timeUntilExpiry < (\d+)/);
assert.ok(inline, `${MANAGER} no longer says when a send refreshes first. Move this check with it.`);
assert.ok(
  REFRESH_LEAD_MS > Number(inline[1]) * 1000,
  "the timer refreshes later than a send would, so sends wait on a refresh",
);

// ── servers holding tokens minted together are not asked together ──

{
  const delays = HOSTS.map((host) => refreshDelayMs(host, NOW + FIFTEEN_MIN, NOW));
  assert.ok(new Set(delays).size === HOSTS.length, `two servers share a refresh time: ${delays}`);
  const span = Math.max(...delays) - Math.min(...delays);
  assert.ok(span >= 20_000, `five servers minted together refresh within ${span}ms of each other`);
}

// Nor after a reconnect, when every stored token may already be past due.
{
  const delays = HOSTS.map((host) => refreshDelayMs(host, NOW - 60_000, NOW));
  for (const d of delays) {
    assert.ok(d >= MIN_REFRESH_DELAY_MS && d < MIN_REFRESH_DELAY_MS + SOON_SPREAD_MS, `an overdue token waits ${d}ms`);
  }
  assert.ok(new Set(delays).size > 1, "overdue tokens on every server all refresh in the same tick");
}

// No token, or one that cannot be read, goes out soon rather than never.
for (const host of HOSTS) {
  const d = refreshDelayMs(host, null, NOW);
  assert.ok(d >= MIN_REFRESH_DELAY_MS && d < MIN_REFRESH_DELAY_MS + SOON_SPREAD_MS, `${host} without a token waits ${d}ms`);
}

// The offset belongs to the host, so a re-plan does not shuffle servers together.
for (const host of HOSTS) {
  assert.equal(hostOffsetMs(host, REFRESH_SPREAD_MS), hostOffsetMs(host, REFRESH_SPREAD_MS));
  assert.ok(hostOffsetMs(host, REFRESH_SPREAD_MS) < REFRESH_SPREAD_MS);
}

assert.ok(RETRY_DELAY_MS >= 60_000, "a server that did not answer is asked again too soon");

// ── and the hook uses it ───────────────────────────────────────────

assert.ok(
  !/setInterval\(\s*refreshServerTokens/.test(hook),
  "the hook still refreshes every server from one shared interval",
);
assert.ok(
  hook.includes("refreshDelayMs(host, accessToken ? getTokenExpiryTime(accessToken) : null, now)"),
  "the hook no longer plans each server from its own token's expiry",
);
assert.ok(
  /\}, \[sockets, tokenRevision\]\);/.test(hook),
  "the plan is not redone when a token arrives, so a refreshed server keeps its old time",
);
{
  const at = manager.indexOf("export function getTokenExpiryTime");
  assert.notEqual(at, -1, `${MANAGER} no longer has getTokenExpiryTime`);
  const body = manager.slice(at, manager.indexOf("\n}\n", at));
  assert.ok(body.includes("decoded.exp * 1000"), "getTokenExpiryTime does not return milliseconds");
}

console.log("token refresh schedule: ok, per server, ahead of sends, and spread");
