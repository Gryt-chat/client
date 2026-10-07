/* eslint-env node */

// An open desktop blocked phone pushes all day: AFK was only ever set in voice. Now the
// desktop says it's away after a minute out of focus or five without input. GRYT-1699.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { IDLE_MS, UNFOCUSED_MS, watchAway } = await import("../src/packages/socket/src/utils/desktopAway.ts");

function fakeDesktop({ focused = true } = {}) {
  let now = 1_000_000;
  let focus = focused;
  const focusListeners = new Set();
  const inputListeners = new Set();
  const ticks = new Set();
  const seen = [];
  const stop = watchAway((away) => seen.push(away), {
    now: () => now,
    focused: () => focus,
    onFocusChange: (cb) => (focusListeners.add(cb), () => focusListeners.delete(cb)),
    onInput: (cb) => (inputListeners.add(cb), () => inputListeners.delete(cb)),
    every: (_ms, cb) => (ticks.add(cb), () => ticks.delete(cb)),
  });
  return {
    seen,
    stop,
    later(ms) {
      now += ms;
      for (const cb of ticks) cb();
    },
    setFocus(f) {
      focus = f;
      for (const cb of focusListeners) cb(f);
    },
    input() {
      for (const cb of inputListeners) cb();
    },
    listeners: () => focusListeners.size + inputListeners.size + ticks.size,
  };
}

// Reading with the window in front is being here, so phones stay quiet.
{
  const d = fakeDesktop();
  assert.deepEqual(d.seen, [false]);
  d.later(IDLE_MS - 1);
  assert.deepEqual(d.seen, [false], "away while still inside the idle window");
  d.later(1);
  assert.deepEqual(d.seen, [false, true], "five minutes without input is away");
  d.input();
  assert.deepEqual(d.seen, [false, true, false], "the next input is back at once, not on the next tick");
}

// Switching to another app hands pushes to the phone after a minute.
{
  const d = fakeDesktop();
  d.setFocus(false);
  d.later(UNFOCUSED_MS - 1);
  assert.deepEqual(d.seen, [false], "a quick look at another window isn't away");
  d.later(1);
  assert.deepEqual(d.seen, [false, true]);
  d.setFocus(true);
  assert.deepEqual(d.seen, [false, true, false], "focus coming back is present at once");
}

// Started minimised or behind something counts its minute from the start.
{
  const d = fakeDesktop({ focused: false });
  assert.deepEqual(d.seen, [false]);
  d.later(UNFOCUSED_MS);
  assert.deepEqual(d.seen, [false, true]);
}

// Input in another window doesn't count, because the page never sees it; nor does stopping leak.
{
  const d = fakeDesktop();
  d.setFocus(false);
  d.later(UNFOCUSED_MS);
  assert.equal(d.seen.at(-1), true);
  d.stop();
  assert.equal(d.listeners(), 0, "listeners left behind after stopping");
}

// Every connected server is told, and told again when one reconnects.
const hook = readFileSync(join(root, "src/packages/socket/src/hooks/useSockets.ts"), "utf8");
assert.match(hook, /socket\.emit\("push:presence", \{ background: awayFromDesktop \}\)/);
assert.match(hook, /\[sockets, serverConnectionStatus, awayFromDesktop\]/);

console.log("desktop-away: ok");
