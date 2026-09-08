/* eslint-env node */

/**
 * Routing a plugin's messages to the right plugin. `pluginMessages.ts` imports
 * nothing, which is why this can drive it without a browser or a socket (GRYT-939).
 */

import assert from "node:assert/strict";

const {
  deliverPluginMessage,
  dropListeners,
  forgetAnnouncedPlugins,
  pluginsOn,
  requireTopic,
  resetAnnouncedPlugins,
  resetPluginMessageListeners,
  serversRunning,
  setAnnouncedPlugins,
  subscribe,
} = await import("../src/packages/addons/src/pluginMessages.ts");

resetPluginMessageListeners();

/* Captured rather than silenced, so "a handler that throws is logged" is an
   assertion — and so this check does not print a stack that reads as a failure. */
const logged = [];
console.error = (...args) => logged.push(args.map(String).join(" "));

/* ── topics ──────────────────────────────────────────────────────────────── */

for (const topic of ["playing", "score.update", "game:started", "a", "A1", "x_y-z", "x".repeat(64)]) {
  assert.equal(requireTopic("presence", topic), topic, `refused a valid topic: ${topic}`);
}

for (const topic of ["", "   ", "with space", "slash/es", 42, null, undefined, "x".repeat(65), "-lead"]) {
  assert.throws(
    () => requireTopic("presence", topic),
    /invalid topic/,
    `allowed an invalid topic: ${JSON.stringify(topic)}`,
  );
}

/*
 * The listener map is keyed on the addon id and the topic with a newline between.
 * A topic allowed to contain one would let a plugin register under another's key.
 */
assert.throws(() => requireTopic("presence", "a\nb"), /invalid topic/);
assert.throws(() => subscribe("presence", "a\nb", () => {}), /invalid topic/);

/* ── receiving ───────────────────────────────────────────────────────────── */

const heard = [];
const stopRef = { fn: subscribe("presence", "playing", (m) => heard.push(m)) };

deliverPluginMessage("presence", { host: "gryt.example", topic: "playing", data: { game: "Doom" } });
assert.deepEqual(heard, [{ host: "gryt.example", topic: "playing", data: { game: "Doom" } }]);

/* Nothing for another topic. */
heard.length = 0;
deliverPluginMessage("presence", { host: "h", topic: "score", data: {} });
assert.deepEqual(heard, []);

/* And nothing for another plugin, which is the point of the namespace: two can
   be installed at once and neither can see the other's manifest. */
heard.length = 0;
subscribe("scoreboard", "playing", () => {});
deliverPluginMessage("scoreboard", { host: "h", topic: "playing", data: {} });
assert.deepEqual(heard, [], "one plugin heard another plugin's message");

/* Delivering to a plugin nobody is listening for is quiet, not an error — most
   servers run no half of most plugins. */
assert.doesNotThrow(() =>
  deliverPluginMessage("nobody", { host: "h", topic: "playing", data: {} }),
);

/* ── one plugin's mistake stays its own ──────────────────────────────────── */

const after = [];
subscribe("presence", "playing", () => {
  throw new Error("plugin bug");
});
subscribe("presence", "playing", (m) => after.push(m.topic));

heard.length = 0;
logged.length = 0;
assert.doesNotThrow(() =>
  deliverPluginMessage("presence", { host: "h", topic: "playing", data: {} }),
);
assert.deepEqual(after, ["playing"], "a handler that threw stopped the next one");
assert.equal(logged.length, 1, "a handler that threw was swallowed rather than logged");
assert.match(logged[0], /presence/);
assert.match(logged[0], /playing/);

/* ── one handler cannot rewrite the message for the next ─────────────────── */

/* Tidiness rather than safety. What it buys is that two handlers on one topic see
   the same message instead of the second seeing what the first left behind. */
resetPluginMessageListeners();

let secondSaw;
subscribe("presence", "playing", (m) => {
  m.topic = "rewritten";
  m.data.game = "rewritten";
});
subscribe("presence", "playing", (m) => {
  secondSaw = { topic: m.topic, game: m.data.game };
});

const original = { host: "h", topic: "playing", data: { game: "Doom" } };
deliverPluginMessage("presence", original);

assert.deepEqual(secondSaw, { topic: "playing", game: "Doom" }, "one handler rewrote the message for the next");
assert.deepEqual(original.data, { game: "Doom" }, "a handler modified the caller's own object");

resetPluginMessageListeners();
const restop = subscribe("presence", "playing", (m) => heard.push(m));
stopRef.fn = restop;

/* ── stopping ────────────────────────────────────────────────────────────── */

stopRef.fn();
heard.length = 0;
deliverPluginMessage("presence", { host: "h", topic: "playing", data: {} });
assert.deepEqual(heard, [], "unsubscribing did not stop delivery");

/*
 * And the app can drop everything an addon was listening for. Without it a
 * disabled plugin keeps receiving and a reloaded one runs two generations.
 */
const survivors = [];
subscribe("presence", "playing", () => survivors.push(1));
subscribe("presence", "score", () => survivors.push(1));
const boardHeard = [];
subscribe("scoreboard", "playing", () => boardHeard.push(1));

dropListeners("presence");

deliverPluginMessage("presence", { host: "h", topic: "playing", data: {} });
deliverPluginMessage("presence", { host: "h", topic: "score", data: {} });
assert.deepEqual(survivors, [], "an addon's listeners survived being dropped");

deliverPluginMessage("scoreboard", { host: "h", topic: "playing", data: {} });
assert.deepEqual(boardHeard, [1], "dropping one addon's listeners took another's with them");

/* ── which servers run the other half ────────────────────────────────────── */

/*
 * A plugin asks this to decide whether to say anything at all. Sending anyway is
 * harmless, but a plugin that knows can stop polling and say why nothing happens.
 */
resetAnnouncedPlugins();

assert.deepEqual(serversRunning("presence"), [], "a plugin heard about a server nobody described");

setAnnouncedPlugins("one.example", [
  { id: "presence", name: "Presence", capabilities: ["messaging"] },
]);
setAnnouncedPlugins("two.example", [
  { id: "scoreboard", name: "Scoreboard", capabilities: [] },
]);
setAnnouncedPlugins("three.example", [
  { id: "presence", name: "Presence", capabilities: ["messaging"] },
  {
    id: "scoreboard",
    name: "Scoreboard",
    author: "somebody",
    description: "Keeps score",
    homepage: "https://example.com/scoreboard",
    capabilities: ["messages:read", "moderation"],
  },
]);

/* Hosts and nothing else: a version number is which known problem applies. Sorted,
   so a plugin iterating them gets the same order each time details arrive. */
assert.deepEqual(serversRunning("presence"), ["one.example", "three.example"]);

assert.deepEqual(serversRunning("nobody-runs-this"), []);

/* Replaced rather than merged, so a plugin the operator removed stops being
   announced on the next details rather than lingering until a reconnect. */
/* ── what is running on one server ───────────────────────────────────────── */

/*
 * Not for plugins. This is the answer to "what is reading my messages here", and
 * the capabilities are the half somebody can act on (GRYT-941).
 */
assert.deepEqual(pluginsOn("three.example"), [
  { id: "presence", name: "Presence", author: undefined, description: undefined, homepage: undefined, capabilities: ["messaging"] },
  {
    id: "scoreboard",
    name: "Scoreboard",
    author: "somebody",
    description: "Keeps score",
    homepage: "https://example.com/scoreboard",
    capabilities: ["messages:read", "moderation"],
  },
]);

/* No version anywhere in it. The server does not send one and nothing here
   should invent a place to put one. */
assert.doesNotMatch(JSON.stringify(pluginsOn("three.example")), /version/i);

/* A server too old to say looks the same as one running nothing, which is worth
   knowing and not worth pretending otherwise about. */
assert.deepEqual(pluginsOn("nobody.example"), []);

/* Handed out as a copy, twice over: the caller cannot edit the stored list or the
   capabilities inside it. A safety net whoever holds it can rewrite is not one. */
const held = pluginsOn("one.example");
held[0].name = "Something Else";
held[0].capabilities.push("moderation");
assert.deepEqual(pluginsOn("one.example"), [
  { id: "presence", name: "Presence", author: undefined, description: undefined, homepage: undefined, capabilities: ["messaging"] },
]);

/* And the same for what was passed in — a caller that keeps its array must not
   be able to change what the app reports afterwards. */
const supplied = [{ id: "later", name: "Later", capabilities: ["messaging"] }];
setAnnouncedPlugins("four.example", supplied);
supplied[0].capabilities.push("moderation");
assert.deepEqual(pluginsOn("four.example"), [
  { id: "later", name: "Later", author: undefined, description: undefined, homepage: undefined, capabilities: ["messaging"] },
]);
forgetAnnouncedPlugins("four.example");

setAnnouncedPlugins("one.example", []);
assert.deepEqual(serversRunning("presence"), ["three.example"]);

/* And a server that is gone takes its list with it, or a plugin keeps sending
   into somewhere nobody is. */
forgetAnnouncedPlugins("three.example");
assert.deepEqual(serversRunning("presence"), []);
/* two.example still has its own — forgetting one server must not touch
   another's list. */
assert.deepEqual(serversRunning("scoreboard"), ["two.example"]);

console.log("check-plugin-messaging: ok");
