import assert from "node:assert/strict";
import test from "node:test";

const CLIENT = import.meta.dirname;

/*
 * The plugin schedules itself with setTimeout, so the timer is captured rather
 * than waited on and a "tick" here is calling what it queued.
 */
function harness({ game = "Factorio", hosts = [] } = {}) {
  const state = {
    game,
    hosts,
    activity: [],
    sent: [],
    logs: [],
    panels: [],
    subs: new Map(),
    cleanup: null,
    pending: null,
    fetches: 0,
  };

  globalThis.fetch = async () => {
    state.fetches += 1;
    if (state.game === undefined) throw new Error("connection refused");
    return { ok: true, json: async () => ({ game: state.game }) };
  };

  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms) => {
    // Leave node:test's own waits alone; only the plugin's poll is captured.
    if (ms === 15_000) {
      state.pending = fn;
      return 1;
    }
    return realTimeout(fn, ms);
  };
  globalThis.clearTimeout = () => {
    state.pending = null;
  };

  globalThis.gryt = {
    version: "1.0.0",
    theme: { appearance: "dark", accentColor: "violet" },
    on: (event, handler) => {
      if (event === "cleanup") state.cleanup = handler;
      return () => {};
    },
    setActivity: async (activity) => void state.activity.push(activity),
    messaging: {
      send: async (topic, data, host) => void state.sent.push({ topic, data, host }),
      on: (topic, handler) => {
        state.subs.set(topic, handler);
        return () => {};
      },
      servers: async () => [...state.hosts],
    },
    ui: {
      panel: async (spec) => void state.panels.push(spec),
      clear: async () => void state.panels.push(null),
    },
    log: {
      info: (m) => state.logs.push(["info", m]),
      warn: (m) => state.logs.push(["warn", m]),
      error: (m) => state.logs.push(["error", m]),
    },
  };

  state.tick = async () => {
    const fn = state.pending;
    state.pending = null;
    await fn();
    await new Promise((r) => realTimeout(r, 0));
  };

  return state;
}

async function start(state) {
  const { activate } = await import(`${CLIENT}/presence/index.js?${Math.random()}`);
  activate();
  // activate() kicks off the first tick without awaiting it.
  await new Promise((r) => setTimeout(r, 5));
  return state;
}

test("presence: sets your own status line with no server involved", async () => {
  const s = await start(harness({ game: "Factorio", hosts: [] }));
  assert.deepEqual(s.activity, ["🎮 Factorio"]);
  assert.equal(s.sent.length, 0, "nowhere to send it");
});

test("presence: a new host gets hello then playing", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));
  assert.deepEqual(s.sent, [
    { topic: "hello", data: { v: 1 }, host: "gryt.example" },
    { topic: "playing", data: { v: 1, game: "Factorio" }, host: "gryt.example" },
  ]);
});

test("presence: an unchanged game sends nothing on the next tick", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));
  const before = s.sent.length;

  await s.tick();
  await s.tick();
  assert.equal(s.sent.length, before, "thirty per ten seconds is the limit");
  assert.equal(s.activity.length, 1, "and the status line is already right");
});

test("presence: a game change reaches the status line and the server", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));
  s.game = "Deep Rock Galactic";
  await s.tick();

  assert.deepEqual(s.activity, ["🎮 Factorio", "🎮 Deep Rock Galactic"]);
  assert.deepEqual(s.sent.at(-1), {
    topic: "playing",
    data: { v: 1, game: "Deep Rock Galactic" },
    host: "gryt.example",
  });
});

test("presence: the source going away clears the status line", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));
  s.game = undefined; // fetch throws, the way it does when nothing is listening
  await s.tick();

  assert.equal(s.activity.at(-1), "");
  assert.deepEqual(s.sent.at(-1), {
    topic: "playing",
    data: { v: 1, game: null },
    host: "gryt.example",
  });
});

test("presence: joining a server mid-session gets told, without a game change", async () => {
  const s = await start(harness({ game: "Factorio", hosts: [] }));
  assert.equal(s.sent.length, 0);

  s.hosts = ["gryt.example"];
  await s.tick();

  assert.deepEqual(s.sent, [
    { topic: "hello", data: { v: 1 }, host: "gryt.example" },
    { topic: "playing", data: { v: 1, game: "Factorio" }, host: "gryt.example" },
  ]);
});

test("presence: a reconnect introduces itself again", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));

  s.hosts = []; // the wifi drops
  await s.tick();
  const before = s.sent.length;

  s.hosts = ["gryt.example"]; // and comes back
  await s.tick();

  assert.deepEqual(s.sent.slice(before), [
    { topic: "hello", data: { v: 1 }, host: "gryt.example" },
    { topic: "playing", data: { v: 1, game: "Factorio" }, host: "gryt.example" },
  ]);
});

test("presence: the roster is checked before it is drawn", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));
  const roster = s.subs.get("roster");
  assert.ok(roster, "subscribed at activate, not on first send");

  roster({ host: "gryt.example", data: "not an array" });
  assert.equal(s.panels.length, 0, "junk is not a roster");

  roster({ host: "gryt.example", data: [{ who: 1, game: 2 }, null, { who: "sam" }] });
  assert.deepEqual(s.panels.at(-1), null, "nothing usable means no panel, not an empty one");

  roster({ host: "gryt.example", data: [{ who: "sam", game: "Tetris" }] });
  assert.deepEqual(s.panels.at(-1), {
    title: "Playing now",
    rows: [{ label: "sam", value: "Tetris" }],
  });
});

test("presence: two servers are one panel, and say which is which", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["one.example", "two.example"] }));
  const roster = s.subs.get("roster");

  roster({ host: "one.example", data: [{ who: "sam", game: "Tetris" }] });
  assert.deepEqual(s.panels.at(-1).rows, [{ label: "sam", value: "Tetris" }],
    "one server, so naming it says nothing");

  roster({ host: "two.example", data: [{ who: "kari", game: "Factorio" }] });
  assert.deepEqual(s.panels.at(-1).rows, [
    { label: "sam", value: "Tetris · one.example" },
    { label: "kari", value: "Factorio · two.example" },
  ]);
});

test("presence: leaving a server takes its people out of the panel", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));
  s.subs.get("roster")({ host: "gryt.example", data: [{ who: "sam", game: "Tetris" }] });
  assert.equal(s.panels.at(-1).rows.length, 1);

  s.hosts = [];
  await s.tick();
  assert.deepEqual(s.panels.at(-1), null, "the panel outlived the server it described");
});

test("presence: turning it off clears the status line and stops the poll", async () => {
  const s = await start(harness({ game: "Factorio", hosts: ["gryt.example"] }));
  const fetches = s.fetches;

  s.cleanup();
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(s.activity.at(-1), "");
  assert.deepEqual(s.panels.at(-1), null, "the panel outlived the plugin");
  assert.equal(s.pending, null, "nothing left queued");
  assert.equal(s.fetches, fetches, "and nothing still polling");
});
