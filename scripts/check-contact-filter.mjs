/* eslint-env node */

// The app's own check on who may message or ring you (GRYT-1470). A fake server that
// ignores your settings sends DMs and rings, and only what passes reaches a listener.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { io } from "socket.io-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  createFloodLimiter,
  directConversationId,
  emptyKnowledge,
  FLOOD_LIMIT,
  installContactGuard,
} = await import("../src/packages/socket/src/utils/contactFilter.ts");

const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(require.resolve("engine.io-client"))("ws");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── the pair id matches the server's ───────────────────────────────────── */

// Copied from packages/server/src/db/sqlite/conversations.ts. If these disagree,
// every one-to-one reads as a group and the settings stop meaning anything.
function serverPairId(a, b) {
  const pair = [a, b].sort();
  return `dm_${createHash("sha256").update(pair.join("\0")).digest("hex").slice(0, 32)}`;
}
assert.equal(directConversationId("alice", "bob"), serverPairId("alice", "bob"));
assert.equal(directConversationId("bob", "alice"), serverPairId("alice", "bob"));

/* ── a server that does what it likes ───────────────────────────────────── */

function hostileServer() {
  let http = null;
  let wss = null;
  let ws = null;
  const server = {
    url: "",
    async up() {
      http = createServer();
      wss = new WebSocketServer({ server: http });
      wss.on("connection", (socket) => {
        ws = socket;
        socket.send(`0${JSON.stringify({ sid: "engine", upgrades: [], pingInterval: 60_000, pingTimeout: 60_000, maxPayload: 1_000_000 })}`);
        socket.on("message", (data) => {
          if (String(data).startsWith("40")) socket.send(`40${JSON.stringify({ sid: "socket" })}`);
        });
      });
      await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
      server.url = `http://127.0.0.1:${http.address().port}`;
    },
    /** A socket.io EVENT packet, the same bytes a real server's emit produces. */
    send(event, payload) {
      ws.send(`42${JSON.stringify([event, payload])}`);
    },
    async down() {
      ws?.terminate();
      await new Promise((resolve) => wss.close(resolve));
      http.closeAllConnections();
      await new Promise((resolve) => http.close(resolve));
    },
  };
  return server;
}

const ME = "me";
const FRIEND = "friend";
const pair = (other) => directConversationId(ME, other);
const message = (from, conversationId = pair(from)) => ({
  message_id: `m-${Math.random()}`,
  conversation_id: conversationId,
  sender_server_id: from,
  sender_nickname: from,
  text: "hi",
  created_at: new Date().toISOString(),
});
const ringFrom = (from, conversationId = pair(from)) => ({
  conversation_id: conversationId,
  from: { server_user_id: from, nickname: from },
  expires_at: Date.now() + 30_000,
});
const view = (other) => ({
  conversation_id: pair(other),
  kind: "dm",
  members: [{ server_user_id: other, nickname: other }],
  other: { server_user_id: other, nickname: other },
});

/** A client with the guard on, and what the app would have done with each event. */
async function connected(prefs, { limiter } = {}) {
  const server = hostileServer();
  await server.up();
  const socket = io(server.url, { transports: ["websocket"], forceNew: true, reconnection: false });
  const filtered = [];
  const knowledge = emptyKnowledge();
  installContactGuard(socket, {
    host: "hostile.example",
    selfId: () => ME,
    prefs: () => prefs,
    knowledge,
    persist: () => {},
    onFiltered: (event) => filtered.push(event),
    limiter,
  });
  // What surfacing means: a notification, a badge, an unread mark or a ringing card.
  const surfaced = { messages: [], rings: [], opened: [] };
  socket.on("chat:new", (m) => surfaced.messages.push(m));
  socket.on("call:incoming", (c) => surfaced.rings.push(c));
  socket.on("dm:opened", (v) => surfaced.opened.push(v));
  await new Promise((resolve) => socket.once("connect", resolve));
  const settle = () => sleep(60);
  return { server, socket, filtered, knowledge, surfaced, settle };
}

const runs = [];
async function run(prefs, options, body) {
  const ctx = await connected(prefs, options);
  runs.push(ctx);
  await body(ctx);
  ctx.socket.close();
  await ctx.server.down();
}

try {
  // The case decision 9 is about: a sender your settings refuse, a DM and a ring,
  // from a server that delivers them anyway. Nothing surfaces but the count.
  await run({ messages: "nobody", calls: "nobody" }, {}, async ({ server, surfaced, filtered, settle }) => {
    server.send("dm:opened", view("stranger"));
    server.send("chat:new", message("stranger"));
    server.send("call:incoming", ringFrom("stranger"));
    await settle();
    assert.deepEqual(surfaced, { messages: [], rings: [], opened: [] }, "something the settings refuse reached the app");
    assert.deepEqual(filtered.map((f) => f.kind).sort(), ["call", "conversation", "message"]);
    assert.ok(filtered.every((f) => f.reason === "setting" && f.host === "hostile.example"));
  });

  // The defaults: messages from anyone, calls from friends. Friends stand in as
  // people you've written to, and the first conversation list is where a device starts.
  await run({ messages: "everyone", calls: "friends" }, {}, async ({ server, socket, surfaced, filtered, knowledge, settle }) => {
    server.send("dm:list", { items: [view(FRIEND)] });
    await settle();
    assert.ok(knowledge.friends.has(FRIEND), "a one-to-one in the first list counts as a friend");

    server.send("call:incoming", ringFrom("stranger"));
    server.send("chat:new", message("stranger"));
    server.send("call:incoming", ringFrom(FRIEND));
    await settle();
    assert.equal(surfaced.rings.length, 1, "only the friend's ring should ring");
    assert.equal(surfaced.rings[0].from.server_user_id, FRIEND);
    assert.equal(surfaced.messages.length, 1, "a message from anyone on the server is let through");
    assert.deepEqual(filtered.map((f) => [f.kind, f.fromId]), [["call", "stranger"]]);

    // Writing to somebody makes them a friend, on this device.
    server.send("dm:opened", view("stranger"));
    await settle();
    socket.emit("chat:send", { conversationId: pair("stranger"), text: "hello back" });
    server.send("call:incoming", ringFrom("stranger"));
    await settle();
    assert.equal(surfaced.rings.length, 2, "a ring from somebody you've written to should ring");
  });

  // A stricter setting covers conversations that are already open (decision 7).
  await (async () => {
    const prefs = { messages: "everyone", calls: "everyone" };
    const ctx = await connected(prefs);
    runs.push(ctx);
    ctx.server.send("chat:new", message("chatty"));
    await ctx.settle();
    assert.equal(ctx.surfaced.messages.length, 1);
    prefs.messages = "friends";
    ctx.server.send("chat:new", message("chatty"));
    await ctx.settle();
    assert.equal(ctx.surfaced.messages.length, 1, "a stricter setting must close a conversation already open");
    assert.equal(ctx.filtered.at(-1)?.reason, "setting");
    ctx.socket.close();
    await ctx.server.down();
  })();

  // A flood: many new conversations at once. The first FLOOD_LIMIT get through, the
  // rest are held back, even with settings that would let every one of them in.
  await run({ messages: "everyone", calls: "everyone" }, {}, async ({ server, surfaced, filtered, settle }) => {
    for (let i = 0; i < 20; i++) server.send("chat:new", message(`spammer-${i}`));
    await settle();
    assert.equal(surfaced.messages.length, FLOOD_LIMIT, `only ${FLOOD_LIMIT} new conversations should get through`);
    assert.equal(filtered.length, 20 - FLOOD_LIMIT);
    assert.ok(filtered.every((f) => f.reason === "flood"));
  });

  // A conversation the flood let in stays in: the cap counts conversations, not messages.
  await run({ messages: "everyone", calls: "everyone" }, {}, async ({ server, surfaced, settle }) => {
    for (let i = 0; i < 12; i++) server.send("chat:new", message("talkative"));
    await settle();
    assert.equal(surfaced.messages.length, 12);
  });

  // A "one-to-one" whose id isn't the pair's is a lie about who it's with.
  await run({ messages: "everyone", calls: "everyone" }, {}, async ({ server, surfaced, filtered, settle }) => {
    server.send("dm:opened", { ...view(FRIEND), conversation_id: "dm_0000000000000000000000000000beef" });
    await settle();
    assert.equal(surfaced.opened.length, 0);
    assert.equal(filtered[0]?.reason, "mismatch");
  });

  // Your own conversations still open: the guard expects what you asked for.
  await run({ messages: "nobody", calls: "nobody" }, {}, async ({ server, socket, surfaced, settle }) => {
    socket.emit("dm:open", { targetServerUserId: "someone" });
    server.send("dm:opened", view("someone"));
    await settle();
    assert.equal(surfaced.opened.length, 1, "a conversation you opened was held back");
  });

  // A later list can't bring back what was held back, until you open it yourself.
  await run({ messages: "nobody", calls: "nobody" }, {}, async ({ server, socket, filtered, knowledge, settle }) => {
    const lists = [];
    socket.on("dm:list", (l) => lists.push(l.items.map((i) => i.conversation_id)));
    server.send("dm:list", { items: [view(FRIEND)] });
    server.send("dm:list", { items: [view(FRIEND), view("stranger")] });
    await settle();
    assert.deepEqual(lists.at(-1), [pair(FRIEND)], "a re-list brought back a conversation the settings refuse");
    assert.equal(filtered.at(-1)?.kind, "conversation");
    knowledge.known.add(pair("stranger"));
    server.send("dm:list", { items: [view(FRIEND), view("stranger")] });
    await settle();
    assert.equal(lists.at(-1).length, 2, "one you let in should stay listed");
  });

  // Channels are the server's own business, and never judged here.
  await run({ messages: "nobody", calls: "nobody" }, {}, async ({ server, surfaced, settle }) => {
    server.send("chat:new", message("anyone", "general"));
    await settle();
    assert.equal(surfaced.messages.length, 1);
  });
} finally {
  for (const ctx of runs) {
    try {
      ctx.socket.close();
    } catch {
      // already closed
    }
  }
}

/* ── the window itself ──────────────────────────────────────────────────── */

const limiter = createFloodLimiter(2, 1000);
assert.equal(limiter.admit(0), true);
assert.equal(limiter.admit(10), true);
assert.equal(limiter.admit(20), false, "a third inside the window");
assert.equal(limiter.admit(1_011), true, "the window slides");

/* ── wired where every server's socket is made ──────────────────────────── */

const sockets = readFileSync(join(root, "src/packages/socket/src/hooks/useSockets.ts"), "utf8");
const guardAt = sockets.indexOf("installContactGuard(socket");
const proofAt = sockets.indexOf("guardSocket(socket");
assert.ok(guardAt !== -1, "useSockets no longer installs the contact guard");
// guardSocket puts `socket.emit` back when it lets go, which would drop the guard's wrapper.
assert.ok(guardAt < proofAt, "the contact guard has to go on before guardSocket");

console.log(
  `contact filter: a refused DM and ring from a hostile server surface nothing but the count, friends ring, a stricter setting closes an open conversation, and a flood stops after ${FLOOD_LIMIT}`,
);
