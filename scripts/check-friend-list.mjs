/* eslint-env node */

// Friends as this device knows them (GRYT-1471). The server's list can take a friend
// away but can't add one you never agreed to, and the contact guard asks the device.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { io } from "socket.io-client";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { directConversationId, emptyKnowledge, installContactGuard } = await import(
  "../src/packages/socket/src/utils/contactFilter.ts"
);
const { confirmFriend, emptyBook, friendState, parseFriendList, reconcile, unconfirmed, watchFriendTraffic } =
  await import("../src/packages/socket/src/utils/friendList.ts");

const require = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(require.resolve("engine.io-client"))("ws");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const at = new Date(0).toISOString();
const person = (id) => ({ serverUserId: id, nickname: id, at });
const list = ({ friends = [], incoming = [], outgoing = [] } = {}) => ({
  friends: friends.map(person),
  incoming: incoming.map(person),
  outgoing: outgoing.map(person),
});

/* ── the book against the server's word ─────────────────────────────────── */

{
  const book = emptyBook();
  reconcile(book, list({ friends: ["stranger"] }), 1_000);
  assert.equal(book.friends.size, 0, "a friend this device never agreed to was added");
  assert.deepEqual(unconfirmed(book, list({ friends: ["stranger"] })).map((p) => p.serverUserId), ["stranger"]);
  assert.equal(friendState(book, list({ friends: ["stranger"] }), "stranger"), "unconfirmed");

  book.asked.set("pal", 1_000);
  reconcile(book, list({ outgoing: ["pal"] }), 2_000);
  assert.ok(book.asked.has("pal"), "a request still waiting stays asked");
  reconcile(book, list({ friends: ["pal"] }), 3_000);
  assert.ok(book.friends.has("pal"), "the friend you asked wasn't added when the server paired you");
  assert.equal(book.asked.has("pal"), false);

  reconcile(book, list(), 4_000);
  assert.equal(book.friends.has("pal"), false, "a friendship the server dropped should go");

  book.asked.set("new", 10_000);
  reconcile(book, list(), 20_000);
  assert.ok(book.asked.has("new"), "a list already on its way when you asked can't undo the ask");
  reconcile(book, list(), 50_000);
  assert.equal(book.asked.has("new"), false, "an ask the server no longer knows about goes");

  confirmFriend(book, person("stranger"));
  assert.equal(friendState(book, list({ friends: ["stranger"] }), "stranger"), "friend");
  assert.equal(parseFriendList("nonsense"), null);
  assert.deepEqual(parseFriendList({ friends: [{ nope: 1 }] }), { friends: [], incoming: [], outgoing: [] });
}

/* ── a server that says what it likes ───────────────────────────────────── */

function hostileServer() {
  let http = null;
  let wss = null;
  let ws = null;
  const received = [];
  const server = {
    url: "",
    received,
    async up() {
      http = createServer();
      wss = new WebSocketServer({ server: http });
      wss.on("connection", (socket) => {
        ws = socket;
        socket.send(`0${JSON.stringify({ sid: "engine", upgrades: [], pingInterval: 60_000, pingTimeout: 60_000, maxPayload: 1_000_000 })}`);
        socket.on("message", (data) => {
          const text = String(data);
          if (text.startsWith("40")) socket.send(`40${JSON.stringify({ sid: "socket" })}`);
          else if (text.startsWith("42")) received.push(JSON.parse(text.slice(2)));
        });
      });
      await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
      server.url = `http://127.0.0.1:${http.address().port}`;
    },
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
const ringFrom = (from) => ({
  conversation_id: directConversationId(ME, from),
  from: { server_user_id: from, nickname: from },
  expires_at: Date.now() + 30_000,
});
const view = (other) => ({
  conversation_id: directConversationId(ME, other),
  kind: "dm",
  members: [{ server_user_id: other, nickname: other }],
  other: { server_user_id: other, nickname: other },
});

const server = hostileServer();
await server.up();
const socket = io(server.url, { transports: ["websocket"], forceNew: true, reconnection: false });
const prefs = { messages: "everyone", calls: "friends" };
const book = emptyBook();
const knowledge = emptyKnowledge();
const filtered = [];
installContactGuard(socket, {
  host: "hostile.example",
  selfId: () => ME,
  prefs: () => prefs,
  knowledge,
  persist: () => {},
  onFiltered: (event) => filtered.push(event),
  friends: { isFriend: (id) => book.friends.has(id), hasAny: () => book.friends.size > 0 },
});
watchFriendTraffic(socket, { book, prefs: () => prefs, persist: () => {} });
const rings = [];
const notices = [];
socket.on("call:incoming", (c) => rings.push(c.from.server_user_id));
socket.on("friend:request:incoming", (n) => notices.push(n.serverUserId));
await new Promise((resolve) => socket.once("connect", resolve));
const settle = () => sleep(60);

try {
  // The case decision 9 is about: the server says a stranger is your friend, and rings.
  server.send("friend:list", list({ friends: ["stranger"] }));
  server.send("call:incoming", ringFrom("stranger"));
  await settle();
  assert.deepEqual(rings, [], "a ring from a friend the server made up got through");
  assert.deepEqual(filtered.map((f) => [f.kind, f.fromId, f.reason]), [["call", "stranger", "setting"]]);

  // You ask, they accept: now the device agrees, and their ring rings.
  socket.emit("friend:request", { accessToken: "t", serverUserId: "pal" });
  await settle();
  assert.deepEqual(server.received.at(-1), ["friend:request", { accessToken: "t", serverUserId: "pal" }]);
  server.send("friend:list", list({ friends: ["stranger", "pal"] }));
  server.send("call:incoming", ringFrom("pal"));
  await settle();
  assert.deepEqual(rings, ["pal"]);

  // Somebody you wrote to stops counting once you have a friend, as on the server.
  server.send("dm:list", { items: [view("talker")] });
  await settle();
  socket.emit("chat:send", { conversationId: directConversationId(ME, "talker"), text: "hi" });
  server.send("call:incoming", ringFrom("talker"));
  await settle();
  assert.deepEqual(rings, ["pal"], "somebody you only wrote to rang past a friends-only setting");

  // Removing them here is believed at once, before the server says anything.
  socket.emit("friend:remove", { accessToken: "t", serverUserId: "pal" });
  server.send("call:incoming", ringFrom("talker"));
  await settle();
  assert.deepEqual(rings, ["pal", "talker"], "with no friends left, somebody you wrote to counts again");

  // A request notice where your settings say nobody is held back.
  prefs.messages = "nobody";
  server.send("friend:request:incoming", { serverUserId: "asker", nickname: "Asker" });
  await settle();
  assert.deepEqual(notices, []);
  prefs.messages = "everyone";
  server.send("friend:request:incoming", { serverUserId: "asker", nickname: "Asker" });
  await settle();
  assert.deepEqual(notices, ["asker"]);
} finally {
  socket.close();
  await server.down();
}

/* ── the book is kept on this device, and only here ─────────────────────── */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const friends = await import("../src/packages/socket/src/hooks/friendsStore.ts");
const kept = friends.friendBookFor("a.example");
kept.asked.set("pal", 5);
kept.friends.set("old", { nickname: "Old", since: 1 });
friends.persistFriendBook("a.example");
const saved = JSON.parse(store.get("gryt_friends"));
assert.deepEqual(Object.keys(saved), ["a.example"]);
assert.deepEqual(saved["a.example"].asked, { pal: 5 });
assert.equal(friends.firstNoticeOf("a.example", "asker"), true);
assert.equal(friends.firstNoticeOf("a.example", "asker"), false, "a request is announced once");
assert.equal(friends.friendGateFor("a.example").isFriend("old"), true);

/* ── wired where every server's socket is made ──────────────────────────── */

const sockets = readFileSync(join(root, "src/packages/socket/src/hooks/useSockets.ts"), "utf8");
assert.ok(sockets.includes("friends: friendGateFor(host)"), "the contact guard no longer asks the device's friends");
const watchAt = sockets.indexOf("watchFriendTraffic(socket");
assert.ok(watchAt !== -1 && watchAt < sockets.indexOf("guardSocket(socket"), "the friend watcher has to go on before guardSocket");

console.log("friend list: a friend the server made up doesn't ring, one you asked does, and removals are believed at once");
