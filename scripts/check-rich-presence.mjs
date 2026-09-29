#!/usr/bin/env node
/**
 * From what a game sends to the card others see. Games resend every few seconds,
 * and each change is a broadcast to every server somebody is on.
 */

import assert from "node:assert/strict";

import { readFileSync } from "node:fs";

import { heldNotice, socketLine } from "../src/packages/settings/src/components/richPresenceCopy.ts";
import { cardFromActivity, createPresenceBoard, MIN_INTERVAL_MS, UNKNOWN_GAME } from "../electron/richPresence.ts";

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.stack ?? err.message}`);
  }
}

console.log("rich presence");

/* ── One activity ────────────────────────────────────────────────────── */

await check("a Discord activity becomes the card's fields and nothing else", () => {
  const card = cardFromActivity(
    {
      type: 0,
      details: "Thragg - Level 14 Warlock",
      state: "Westfall",
      timestamps: { start: 1_790_000_000 },
      party: { id: "p1", size: [2, 5] },
      assets: { large_image: "wow", large_text: "WoW" },
      secrets: { join: "secret" },
      buttons: [{ label: "Armory", url: "https://example.com" }, { label: "B", url: "https://b.example" }, { label: "C", url: "https://c.example" }],
      instance: true,
    },
    "World of Warcraft",
  );
  assert.deepEqual(card, {
    type: "playing",
    name: "World of Warcraft",
    details: "Thragg - Level 14 Warlock",
    state: "Westfall",
    startedAt: 1_790_000_000_000,
    party: { size: 2, max: 5 },
    buttons: [{ label: "Armory", url: "https://example.com" }, { label: "B", url: "https://b.example" }],
  });
});

await check("a start in milliseconds is left as it is", () => {
  assert.equal(cardFromActivity({ timestamps: { start: 1_790_000_000_123 } }, "x").startedAt, 1_790_000_000_123);
});

await check("listening and watching keep their type", () => {
  assert.equal(cardFromActivity({ type: 2 }, "x").type, "listening");
  assert.equal(cardFromActivity({ type: 3 }, "x").type, "watching");
  assert.equal(cardFromActivity({ type: 1 }, "x").type, "playing");
});

/* ── The board ───────────────────────────────────────────────────────── */

function harness(names = { "100": "Factorio" }) {
  const clock = 1_000_000;
  const sent = [];
  const board = createPresenceBoard({
    onChange: (card) => sent.push(card),
    nameForApp: (id) => names[id] ?? null,
    now: () => clock,
  });
  return {
    board,
    sent,
  };
}

const ev = (connection, clientId, activity) => ({ connection, clientId, activity });

await check("the name comes from the list, then from the game, then a placeholder", () => {
  const { board, sent } = harness();
  board.update(ev(1, "100", { state: "a" }));
  assert.equal(sent.at(-1).name, "Factorio");
  board.update(ev(2, "200", { name: "Own Name", state: "b" }));
  assert.equal(sent.length, 1, "a second game inside the interval went out at once");
  board.stop();

  const other = harness({});
  other.board.update(ev(1, "300", { state: "c" }));
  assert.equal(other.sent.at(-1).name, UNKNOWN_GAME);
  other.board.stop();
});

await check("a game resending the same card sends nothing", () => {
  const { board, sent } = harness();
  for (let i = 0; i < 20; i++) board.update(ev(1, "100", { state: "same" }));
  assert.equal(sent.length, 1);
  board.stop();
});

await check("changes inside the interval are held, and the latest goes out at the end", async () => {
  const sent = [];
  const board = createPresenceBoard({ onChange: (c) => sent.push(c), nameForApp: () => "G", minIntervalMs: 30 });
  board.update(ev(1, "1", { state: "wave 1" }));
  board.update(ev(1, "1", { state: "wave 2" }));
  board.update(ev(1, "1", { state: "wave 3" }));
  assert.equal(sent.length, 1);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].state, "wave 3");
  board.stop();
});

await check("a clear goes out at once, even inside the interval", () => {
  const { board, sent } = harness();
  board.update(ev(1, "100", { state: "a" }));
  board.update(ev(1, "100", null));
  assert.deepEqual(sent, [sent[0], null]);
  board.stop();
});

await check("a hidden app is never shown, and hiding the shown one clears it", () => {
  const { board, sent } = harness();
  board.setHidden(["100"]);
  board.update(ev(1, "100", { state: "secret" }));
  assert.equal(sent.length, 0);
  board.setHidden([]);
  assert.equal(sent.at(-1).name, "Factorio");
  board.setHidden(["100"]);
  assert.equal(sent.at(-1), null);
  board.stop();
});

await check("with two games open, closing one shows the other", async () => {
  const quickSent = [];
  const board = createPresenceBoard({ onChange: (c) => quickSent.push(c), nameForApp: (id) => ({ a: "A", b: "B" })[id], minIntervalMs: 0 });
  board.update(ev(1, "a", { state: "1" }));
  await new Promise((r) => setTimeout(r, 2));
  board.update(ev(2, "b", { state: "2" }));
  assert.equal(quickSent.at(-1).name, "B");
  board.update(ev(2, "b", null));
  assert.equal(quickSent.at(-1).name, "A");
  board.stop();
});

await check("the apps seen are listed for hiding, with a name only where one is known", () => {
  const { board } = harness();
  board.update(ev(1, "100", { state: "a" }));
  board.update(ev(2, "999", { state: "b" }));
  assert.deepEqual(board.seen(), [{ id: "100", name: "Factorio" }, { id: "999", name: null }]);
  board.stop();
});

/* ── Consent and wording ─────────────────────────────────────────────── */

const main = readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8");

await check("nothing opens the socket before somebody turns it on", () => {
  const start = main.match(/function startRichPresence\(\): void \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(start, /if \(!canHostRichPresence \|\| rpcHost \|\| !readRichPresenceConsent\(\)\) return;/);
  const setConsent = main.match(/ipcMain\.handle\("rich-presence-set-consent"[\s\S]*?\n {6}\}\);/)?.[0] ?? "";
  assert.match(setConsent, /await stopRichPresence\(\)/, "turning it off doesn't let go of the socket");
});

await check("when Discord has the connection, settings says it's Discord and how to fix it", () => {
  const line = socketLine({ state: "yielded", holder: { name: "Discord", isDiscord: true } });
  assert.equal(line.warn, true);
  assert.match(line.text, /^Discord is holding the game connection, so games report to Discord instead of Gryt\.$/);
  assert.match(line.fix, /Quit Discord/);
  assert.match(heldNotice("Discord Canary"), /^Discord Canary got to the game connection first/);
});

await check("another holder is named as itself, and an unknown one isn't called Discord", () => {
  assert.match(socketLine({ state: "yielded", holder: { name: "SomeLauncher", isDiscord: false } }).text, /^SomeLauncher is holding/);
  assert.doesNotMatch(socketLine({ state: "yielded", holder: null }).text, /Discord/);
  assert.equal(socketLine({ state: "holding", holder: null }).warn, false);
});

console.log(failures === 0 ? "\nrich presence: ok" : `\nrich presence: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
