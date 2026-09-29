#!/usr/bin/env node
/**
 * The Rich Presence socket. Gryt takes slot 0 when it is free and answers games
 * itself, and leaves a Discord that got there first alone.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, existsSync, linkSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRpcHost,
  describeHolder,
  encodeFrame,
  findHolder,
  FrameReader,
  ipcDir,
  ipcPath,
  MAX_FRAME_BYTES,
  Op,
  parseLsof,
} from "../electron/discordIpc.ts";

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, what, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return;
    await wait(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Short, because a Unix socket path has to fit in 104 bytes on macOS. */
function freshDir() {
  return mkdtempSync(join(tmpdir(), "gipc-"));
}

/** A game as the discord-rpc libraries behave: connect, handshake, then frames. */
function fakeGame(path) {
  const reader = new FrameReader();
  const frames = [];
  const bytes = [];
  const socket = createConnection(path);
  socket.on("data", (chunk) => {
    bytes.push(chunk);
    try {
      frames.push(...reader.push(chunk));
    } catch {
      /* a test that sends garbage reads the bytes instead */
    }
  });
  socket.on("error", () => {});
  const connected = new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    frames,
    received: () => Buffer.concat(bytes),
    connected,
    send: (op, body) => socket.write(encodeFrame(op, body)),
    closed: new Promise((r) => socket.once("close", r)),
  };
}

/** Discord on some slot: records every byte and replies to a handshake with its own READY. */
function fakeDiscord(path, reply = (op, body) => [encodeFrame(Op.Frame, { cmd: "DISPATCH", evt: "READY", nonce: null, data: { user: { id: "4242", username: "real" } }, echo: body?.client_id })]) {
  const received = [];
  const sent = [];
  const connections = [];
  const server = createServer((socket) => {
    connections.push(socket);
    const reader = new FrameReader();
    socket.on("data", (chunk) => {
      received.push(chunk);
      let frames = [];
      try {
        frames = reader.push(chunk);
      } catch {
        return;
      }
      for (const f of frames) {
        for (const out of reply(f.op, f.body)) {
          sent.push(out);
          socket.write(out);
        }
      }
    });
    socket.on("error", () => {});
  });
  return {
    server,
    received: () => Buffer.concat(received),
    sent: () => Buffer.concat(sent),
    connections,
    listening: new Promise((resolve) => server.listen(path, resolve)),
    close: () => new Promise((r) => {
      for (const c of connections) c.destroy();
      server.close(() => r());
    }),
  };
}

function host(dir, events = [], states = [], extra = {}) {
  return createRpcHost({
    dir,
    platform: process.platform === "win32" ? "linux" : process.platform,
    env: {},
    retryMs: 50,
    onActivity: (e) => events.push(e),
    onState: (s) => states.push(s),
    ...extra,
  });
}

console.log("discord ipc");

/* ── Framing ─────────────────────────────────────────────────────────── */

await check("a frame survives arriving one byte at a time", () => {
  const bytes = Buffer.concat([
    encodeFrame(Op.Handshake, { v: 1, client_id: "123" }),
    encodeFrame(Op.Frame, { cmd: "SET_ACTIVITY", args: { activity: { state: "æøå 🎮" } }, nonce: "n1" }),
  ]);
  const reader = new FrameReader();
  const frames = [];
  for (const byte of bytes) frames.push(...reader.push(Buffer.from([byte])));
  assert.equal(frames.length, 2);
  assert.equal(frames[0].op, Op.Handshake);
  assert.equal(frames[1].body.args.activity.state, "æøå 🎮");
});

await check("a frame claiming to be huge is refused before it is buffered", () => {
  const header = Buffer.alloc(8);
  header.writeInt32LE(Op.Frame, 0);
  header.writeInt32LE(MAX_FRAME_BYTES + 1, 4);
  assert.throws(() => new FrameReader().push(header));
});

await check("an unknown opcode is refused", () => {
  const header = Buffer.alloc(8);
  header.writeInt32LE(9, 0);
  assert.throws(() => new FrameReader().push(header));
});

/* ── Paths ───────────────────────────────────────────────────────────── */

await check("the folder is the first of the variables the discord-rpc libraries read", () => {
  assert.equal(ipcDir({ XDG_RUNTIME_DIR: "/run/user/1000", TMPDIR: "/t" }, "linux"), "/run/user/1000");
  assert.equal(ipcDir({ TMPDIR: "/var/folders/x/T/" }, "darwin"), "/var/folders/x/T/");
  assert.equal(ipcDir({ TEMP: "/temp" }, "linux"), "/temp");
  assert.equal(ipcDir({}, "linux"), "/tmp");
  assert.equal(ipcPath(0, ipcDir({}, "win32"), "win32"), "\\\\?\\pipe\\discord-ipc-0");
});

await check("Discord and the clients built on it are called by their names", () => {
  assert.deepEqual(describeHolder(1, "Discord"), { pid: 1, name: "Discord", isDiscord: true });
  assert.equal(describeHolder(1, "Discord.exe").name, "Discord");
  assert.equal(describeHolder(1, "DiscordCanary.exe").name, "Discord Canary");
  assert.equal(describeHolder(1, "Discord PTB").name, "Discord PTB");
  assert.equal(describeHolder(1, "/opt/Vesktop/vesktop").name, "Vesktop");
  assert.equal(describeHolder(1, "ArmCord.exe").name, "ArmCord");
  assert.deepEqual(describeHolder(2, "SomeLauncher.exe"), { pid: 2, name: "SomeLauncher", isDiscord: false });
});

await check("lsof output gives the process bound at the slot, and never Gryt itself", () => {
  const path = "/var/folders/x/T/discord-ipc-0";
  const out = ["p10", "cnode", "f12", `n${path}.gryt-10`, "p951", "cDiscord", "f35", `n${path}`, "p952", "cDiscord", "f1", "n/var/folders/x/T/discord-ipc-1", ""].join("\n");
  assert.deepEqual(parseLsof(out, path, 10), { pid: 951, name: "Discord", isDiscord: true });
  assert.deepEqual(parseLsof(out, path, 999), { pid: 10, name: "node", isDiscord: false });
  assert.equal(parseLsof(out, "/tmp/discord-ipc-0", 999), null);
});

if (process.platform === "win32") {
  console.log("  skip  socket checks use Unix sockets");
  process.exit(failures === 0 ? 0 : 1);
}

/* ── Without Discord ─────────────────────────────────────────────────── */

await check("with no Discord, Gryt answers the game itself", async () => {
  const dir = freshDir();
  const events = [];
  const rpc = host(dir, events);
  try {
    assert.equal(await rpc.start(), "holding");
    const game = fakeGame(ipcPath(0, dir));
    await game.connected;
    game.send(Op.Handshake, { v: 1, client_id: "356875570916753438" });
    await until(() => game.frames.length >= 1, "READY");
    assert.equal(game.frames[0].body.evt, "READY");

    game.send(Op.Frame, { cmd: "SET_ACTIVITY", nonce: "abc", args: { pid: 4321, activity: { details: "Ranked", party: { size: [2, 5] } } } });
    await until(() => game.frames.length >= 2, "the SET_ACTIVITY answer");
    assert.equal(game.frames[1].body.nonce, "abc");
    assert.equal(game.frames[1].body.cmd, "SET_ACTIVITY");
    assert.equal(events.length, 1);
    assert.deepEqual(
      { clientId: events[0].clientId, pid: events[0].pid, details: events[0].activity.details },
      { clientId: "356875570916753438", pid: 4321, details: "Ranked" },
    );

    game.send(Op.Ping, { n: 1 });
    await until(() => game.frames.length >= 3, "PONG");
    assert.equal(game.frames[2].op, Op.Pong);

    game.socket.destroy();
    await until(() => events.length === 2, "the clear on disconnect");
    assert.equal(events[1].activity, null);
  } finally {
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("a handshake with no client id is closed, and nothing is reported", async () => {
  const dir = freshDir();
  const events = [];
  const rpc = host(dir, events);
  try {
    await rpc.start();
    const game = fakeGame(ipcPath(0, dir));
    await game.connected;
    game.send(Op.Handshake, { v: 1 });
    await game.closed;
    assert.equal(game.frames[0]?.op, Op.Close);
    assert.equal(events.length, 0);
  } finally {
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("garbage from a local client closes it and nothing else", async () => {
  const dir = freshDir();
  const rpc = host(dir);
  try {
    await rpc.start();
    const game = fakeGame(ipcPath(0, dir));
    await game.connected;
    game.socket.write(Buffer.from("GET / HTTP/1.1\r\n\r\n"));
    await game.closed;
    const again = fakeGame(ipcPath(0, dir));
    await again.connected;
    again.socket.destroy();
  } finally {
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── With Discord on another slot ────────────────────────────────────── */

await check("a Discord on slot 1 gets nothing while Gryt holds slot 0", async () => {
  const dir = freshDir();
  const discord = fakeDiscord(ipcPath(1, dir));
  await discord.listening;
  const events = [];
  const rpc = host(dir, events);
  try {
    assert.equal(await rpc.start(), "holding");
    const game = fakeGame(ipcPath(0, dir));
    await game.connected;
    game.send(Op.Handshake, { v: 1, client_id: "1234567890" });
    game.send(Op.Frame, { cmd: "SET_ACTIVITY", nonce: "n-1", args: { activity: { state: "In a match" } } });
    await until(() => game.frames.length >= 2, "Gryt's answers");
    assert.equal(game.frames[0].body.data.user.id, "0", "the game got somebody else's READY");
    assert.equal(events[0].activity.state, "In a match");
    assert.equal(discord.connections.length, 0, "Gryt connected to Discord");
    assert.equal(discord.received().length, 0);
  } finally {
    await rpc.stop();
    await discord.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("a command Gryt doesn't do gets an error, and the connection stays", async () => {
  const dir = freshDir();
  const rpc = host(dir);
  try {
    await rpc.start();
    const game = fakeGame(ipcPath(0, dir));
    await game.connected;
    game.send(Op.Handshake, { v: 1, client_id: "5" });
    game.send(Op.Frame, { cmd: "SUBSCRIBE", evt: "ACTIVITY_JOIN", nonce: "s" });
    game.send(Op.Frame, { cmd: "SEND_ACTIVITY_JOIN_INVITE", nonce: "x", args: {} });
    await until(() => game.frames.length >= 3, "three answers");
    assert.equal(game.frames[1].body.evt, null);
    assert.equal(game.frames[2].body.evt, "ERROR");
    assert.equal(game.frames[2].body.nonce, "x");
    assert.ok(!game.socket.destroyed);
    game.socket.destroy();
  } finally {
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("a command before the handshake is closed", async () => {
  const dir = freshDir();
  const events = [];
  const rpc = host(dir, events);
  try {
    await rpc.start();
    const game = fakeGame(ipcPath(0, dir));
    await game.connected;
    game.send(Op.Frame, { cmd: "SET_ACTIVITY", nonce: "1", args: { activity: { state: "x" } } });
    await game.closed;
    assert.equal(events.length, 0);
  } finally {
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ── When Discord has slot 0 ─────────────────────────────────────────── */

/** A listener in another process, the way Discord is one. Gryt ignores its own pid when looking. */
function otherProcessListening(path) {
  const child = spawn(process.execPath, [
    "-e",
    `const s=require("net").createServer(c=>{console.log("connected");c.on("data",()=>{})});s.listen(${JSON.stringify(path)},()=>console.log("up"))`,
  ]);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  const up = new Promise((resolve) => child.stdout.once("data", resolve));
  return { child, up, output: () => output };
}

await check("a holder is named without connecting to it", async () => {
  const dir = freshDir();
  const slot0 = ipcPath(0, dir);
  const { child, up } = otherProcessListening(slot0);
  try {
    await up;
    const found = await findHolder(slot0);
    assert.equal(found?.pid, child.pid);
    assert.equal(found?.isDiscord, false);
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("Gryt leaves a program on slot 0 alone, and takes the slot once it is gone", async () => {
  const dir = freshDir();
  const slot0 = ipcPath(0, dir);
  const { child, up, output } = otherProcessListening(slot0);
  await up;
  const inode = statSync(slot0).ino;
  const states = [];
  const rpc = createRpcHost({
    dir,
    env: {},
    retryMs: 50,
    onActivity: () => {},
    onState: (state, holder) => states.push([state, holder?.pid ?? null]),
  });
  try {
    assert.equal(await rpc.start(), "yielded");
    assert.equal(rpc.holder()?.pid, child.pid);
    assert.equal(statSync(slot0).ino, inode, "the other program's socket was replaced");
    await wait(200);
    assert.ok(!output().includes("connected"), "Gryt connected to the holder, which Discord would take for a game");

    /* Killed, so its socket file stays behind, the way Discord leaves one when it quits. */
    child.kill("SIGKILL");
    await until(() => rpc.state() === "holding", "Gryt to take the slot after the holder went", 5000);
    assert.deepEqual(states, [["yielded", child.pid], ["holding", null]]);
  } finally {
    child.kill("SIGKILL");
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("a socket file nobody listens on is replaced", async () => {
  const dir = freshDir();
  const slot0 = ipcPath(0, dir);
  /* Bound, linked into place, then closed: what a crashed Discord leaves behind. */
  const dead = createServer();
  await new Promise((r) => dead.listen(join(dir, "dead"), r));
  linkSync(join(dir, "dead"), slot0);
  await new Promise((r) => dead.close(r));
  assert.ok(existsSync(slot0));
  const rpc = host(dir);
  try {
    assert.equal(await rpc.start(), "holding");
  } finally {
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("stopping removes Gryt's socket and nothing else", async () => {
  const dir = freshDir();
  const slot0 = ipcPath(0, dir);
  const rpc = host(dir);
  try {
    await rpc.start();
    assert.ok(existsSync(slot0));
    await rpc.stop();
    assert.ok(!existsSync(slot0), "Gryt left its socket behind");
    assert.equal(rpc.state(), "off");

    /* Something replaced Gryt's file while it held the slot. Stopping must leave that one. */
    await rpc.start();
    await unlink(slot0);
    const other = fakeDiscord(slot0, () => []);
    await other.listening;
    await rpc.stop();
    assert.ok(existsSync(slot0), "Gryt removed a socket that was not its own");
    await other.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("a program opening connections in a loop is cut off at the cap", async () => {
  const dir = freshDir();
  const rpc = host(dir, [], [], { maxConnections: 2 });
  try {
    await rpc.start();
    const games = [fakeGame(ipcPath(0, dir)), fakeGame(ipcPath(0, dir)), fakeGame(ipcPath(0, dir))];
    await Promise.all(games.map((g) => g.connected));
    await games[2].closed;
    for (const g of games) g.socket.destroy();
  } finally {
    await rpc.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(
  failures === 0
    ? "\ndiscord ipc: Gryt answers games on a free slot 0, and Discord's own socket is never touched."
    : `\ndiscord ipc: ${failures} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
