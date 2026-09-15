/* eslint-env node */

// Every app's SFU gets control and metrics ports of its own, and its servers register
// with it rather than with another app's SFU holding 9092. GRYT-1220.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = "electron/embeddedServerConfig.ts";
const MANAGER = "electron/embeddedServerManager.ts";
const read = (path) => fs.readFileSync(join(root, path), "utf8");
const moduleBody = (path, names) =>
  `${stripTypeScriptTypes(read(path))
    .replace(/^import[\s\S]*?from "[^"]+";$/gm, "")
    .replace(/^export /gm, "")}\nreturn { ${names.join(", ")} };`;

const scratch = fs.mkdtempSync(join(tmpdir(), "gryt-sfu-ports-"));
const logged = [];
const quiet = { ...console, log: (...args) => logged.push(args.join(" ")) };
process.on("exit", (code) => {
  fs.rmSync(scratch, { recursive: true, force: true });
  if (code !== 0) console.error(`\nWhat the manager logged:\n${logged.join("\n")}`);
});
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── ports ─────────────────────────────────────────────────────────────── */

function listen(port, host = "0.0.0.0") {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(null));
    srv.listen(port, host, () => resolve(srv));
  });
}
const close = (srv) => new Promise((resolve) => (srv ? srv.close(() => resolve()) : resolve()));

async function canListen(port, host = "0.0.0.0") {
  const srv = createServer();
  const ok = await new Promise((resolve) => {
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => resolve(true));
  });
  if (ok) await close(srv);
  return ok;
}

/* Holds a port the way another app's SFU does. Something on this machine already holding it counts too. */
async function hold(port, host = "0.0.0.0") {
  const srv = await listen(port, host);
  assert.equal(await canListen(port, host), false, `could not make ${host}:${port} unavailable for this check`);
  return () => close(srv);
}

async function freePorts(count) {
  const servers = await Promise.all(Array.from({ length: count }, () => listen(0)));
  const ports = servers.map((srv) => srv.address().port);
  await Promise.all(servers.map(close));
  return ports;
}

/* ── the modules as written ────────────────────────────────────────────── */

/* A fresh app each time: its own userData, and a runtime with the SFU and server files in it. */
let apps = 0;
function newApp() {
  const dir = join(scratch, `app-${++apps}`);
  const os = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  const sfu = join(dir, "build", "embedded-server", "sfu", `${os}-${process.arch === "arm64" ? "arm64" : "x64"}`);
  const server = join(dir, "build", "embedded-server", "server");
  fs.mkdirSync(sfu, { recursive: true });
  fs.mkdirSync(server, { recursive: true });
  fs.writeFileSync(join(sfu, process.platform === "win32" ? "gryt_sfu.exe" : "gryt_sfu"), "");
  fs.writeFileSync(join(server, "bundle.js"), "");
  return { getPath: () => join(dir, "userData"), getAppPath: () => dir, isPackaged: false };
}

const CONFIG_EXPORTS = [
  "checkPortsAvailable", "claimSfuLocalPorts", "deleteServerFiles", "describePortConflicts",
  "generateConfig", "getLanIp", "getServerDir", "hasExistingServer", "isPortAvailable",
  "listServerConfigs", "listServerIds", "loadConfig", "suggestServerPort",
  "updateCustomAdvertisedAddresses", "updateServerPorts",
];

function loadConfigModule(app) {
  return new Function(
    "randomBytes", "createSocket", "app", "existsSync", "mkdirSync", "readdirSync",
    "readFileSync", "rmSync", "writeFileSync", "createServer", "networkInterfaces", "join", "console",
    moduleBody(CONFIG, CONFIG_EXPORTS),
  )(
    randomBytes, createSocket, app, fs.existsSync, fs.mkdirSync, fs.readdirSync,
    fs.readFileSync, fs.rmSync, fs.writeFileSync, createServer, networkInterfaces, join, quiet,
  );
}

/* The SFU binds what it was told, like the real one, so a port it is running on reads as taken. */
function fakeSfu(env) {
  const proc = Object.assign(new EventEmitter(), { pid: 40001, killed: false, env, sockets: [] });
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.ready = Promise.all(
    [["Control", env.SFU_CONTROL_PORT, env.SFU_CONTROL_HOST], ["Metrics", env.SFU_METRICS_PORT]].map(async ([name, value, host]) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port <= 0) return;
      const srv = await listen(port, host || "0.0.0.0");
      if (srv) proc.sockets.push(srv);
      else proc.stdout.emit("data", Buffer.from(`❌ ${name} listener stopped: listen tcp :${port}: bind: address already in use`));
    }),
  );
  proc.kill = () => {
    proc.killed = true;
    proc.released = proc.ready.then(() => Promise.all(proc.sockets.map(close)));
    return true;
  };
  return proc;
}

/* The manager as written, with only process creation faked. */
function loadManager(app, { onSpawn = () => {} } = {}) {
  const config = loadConfigModule(app);
  const spawned = { sfu: [], server: [] };

  const spawn = (binary, args, opts) => {
    const proc = fakeSfu(opts.env);
    spawned.sfu.push(proc);
    onSpawn(proc);
    return proc;
  };
  const fork = (entry, args, opts) => {
    const proc = Object.assign(new EventEmitter(), { pid: 40100, killed: false, env: opts.env });
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => { proc.killed = true; return true; };
    spawned.server.push(proc);
    return proc;
  };
  // The kill fallback waits three seconds and the start watchdog ten. Neither should hold the check open.
  const timer = (fn, ms) => {
    const handle = setTimeout(fn, ms);
    if (ms >= 1000) handle.unref();
    return handle;
  };
  const store = {};

  const manager = new Function(
    "fork", "spawn", "app", "existsSync", "readFileSync", "chmod", "cp", "mkdir", "rename",
    "rm", "writeFile", "createServer", "join", "extract", "loadGlobalStore", "setGlobalValue",
    "setTimeout", "clearTimeout", "process", "console", ...CONFIG_EXPORTS,
    moduleBody(MANAGER, ["createAndStartServer", "startExistingServer", "stopAllServers", "getEmbeddedServerState"]),
  )(
    fork, spawn, app, fs.existsSync, fs.readFileSync, null, null, null, null,
    null, null, createServer, join, null, () => store, (key, value) => { store[key] = value; },
    timer, clearTimeout,
    // The Electron process can carry the SFU's own variables, and the config's ports have to win.
    { ...process, env: { ...process.env, SFU_CONTROL_PORT: "9092", SFU_CONTROL_HOST: "0.0.0.0", SFU_METRICS_PORT: "9091" }, resourcesPath: join(scratch, "none") },
    quiet,
    ...CONFIG_EXPORTS.map((name) => config[name]),
  );

  const stopAll = async () => {
    manager.stopAllServers();
    await Promise.all(spawned.sfu.map((sfu) => sfu.released));
  };
  return { manager, spawned, stopAll };
}

const window = { isDestroyed: () => false, webContents: { send: () => {} } };
const started = (sfu) => ({ control: Number(sfu.env.SFU_CONTROL_PORT), metrics: Number(sfu.env.SFU_METRICS_PORT) });
/* The server keeps SFU_WS_HOST's host when the SFU sends it to the control port, so that is where it registers. */
const registersOn = (server) => new URL(server.env.SFU_WS_HOST).hostname;
const recorded = (path) => {
  const text = fs.readFileSync(path, "utf8");
  const line = (key) => Number(text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]);
  return { control: line("SFU_CONTROL_PORT"), metrics: line("SFU_METRICS_PORT") };
};

async function serverStarted(spawned, count) {
  for (let i = 0; i < 40 && spawned.server.length < count; i++) await settle(50);
  assert.equal(spawned.server.length, count, "the embedded server was never started");
  return spawned.server[count - 1];
}

/* ── the reported case: another app's SFU holds 9091 and 9092 ─────────── */

// An SFU from before SFU_CONTROL_HOST holds control on every interface. A newer one holds it on
// loopback only, which a wildcard probe alone can miss.
for (const controlHeldOn of ["0.0.0.0", "127.0.0.1"]) {
  const release = [await hold(9091), await hold(9092, controlHeldOn)];
  const { manager, spawned, stopAll } = loadManager(newApp());

  const state = await manager.createAndStartServer(window, "Second app", false);
  assert.ok(state, `createAndStartServer failed with 9091 and ${controlHeldOn}:9092 taken`);
  assert.equal(spawned.sfu.length, 1, "no SFU was started");

  const sfu = spawned.sfu[0];
  await sfu.ready;
  const ports = started(sfu);
  const config = manager.getEmbeddedServerState(state.id).config;
  for (const [name, port] of Object.entries(ports)) {
    assert.ok(Number.isInteger(port) && port > 0, `the SFU was started without SFU_${name.toUpperCase()}_PORT, so it takes the default`);
    assert.ok(![9091, 9092].includes(port), `the SFU was told to take ${name} on ${port}, which another app holds on ${controlHeldOn}`);
  }
  assert.notEqual(ports.control, ports.metrics, "control and metrics were given the same port");
  assert.ok(![config.serverPort, config.sfuPort].includes(ports.control), "control landed on a port this server uses");
  assert.deepEqual({ control: config.controlPort, metrics: config.metricsPort }, ports, "the config and the SFU it started disagree");
  assert.deepEqual(recorded(config.configPath), ports, "config.env does not record the ports the SFU was given");
  assert.equal(sfu.env.SFU_PORT, String(config.sfuPort));
  assert.equal(sfu.env.PORT, String(config.sfuPort));
  assert.equal(sfu.env.SFU_CONTROL_HOST, "127.0.0.1", "the SFU takes registration from other machines, or kept the Electron process's own value");

  // The server dials this SFU's signalling port, and that SFU's refusal names the control port it was given.
  const server = await serverStarted(spawned, 1);
  assert.equal(server.env.SFU_WS_HOST, `ws://127.0.0.1:${sfu.env.SFU_PORT}`, "the server is pointed somewhere other than the SFU this app started");
  assert.equal(server.env.SFU_CONTROL_PORT, String(ports.control));
  assert.equal(registersOn(server), sfu.env.SFU_CONTROL_HOST, "the server registers on an address the SFU's control port does not listen on");

  await stopAll();
  for (const r of release) await r();
}

/* ── kept while free, moved when taken at start ─────────────────────────── */

{
  const app = newApp();
  const [controlPort, metricsPort] = await freePorts(2);
  const first = loadManager(app);
  const created = await first.manager.createAndStartServer(window, "Stable", false);
  await serverStarted(first.spawned, 1);
  await first.stopAll();

  const { configPath } = first.manager.getEmbeddedServerState(created.id).config;
  const raw = fs.readFileSync(configPath, "utf8")
    .replace(/^SFU_CONTROL_PORT=.*$/m, `SFU_CONTROL_PORT=${controlPort}`)
    .replace(/^SFU_METRICS_PORT=.*$/m, `SFU_METRICS_PORT=${metricsPort}`);
  fs.writeFileSync(configPath, raw);

  for (const restart of [1, 2]) {
    const { manager, spawned, stopAll } = loadManager(app);
    await manager.startExistingServer(window, created.id);
    assert.equal(spawned.sfu.length, 1, `restart ${restart} started no SFU`);
    assert.deepEqual(started(spawned.sfu[0]), { control: controlPort, metrics: metricsPort }, `restart ${restart} moved ports that were free`);
    assert.equal(fs.readFileSync(configPath, "utf8"), raw, `restart ${restart} rewrote config.env with nothing taken`);
    assert.equal(spawned.sfu[0].env.SFU_CONTROL_HOST, "127.0.0.1", `restart ${restart} started an SFU that takes registration from other machines`);
    await serverStarted(spawned, 1);
    await stopAll();
  }

  // Somebody took the recorded control port while the app was closed. Only that one moves.
  const release = await hold(controlPort);
  let moved;
  {
    const { manager, spawned, stopAll } = loadManager(app);
    await manager.startExistingServer(window, created.id);
    await spawned.sfu[0].ready;
    moved = started(spawned.sfu[0]);
    assert.notEqual(moved.control, controlPort, "the SFU was started on a control port another process holds");
    assert.equal(moved.metrics, metricsPort, "metrics moved though its port was free");
    assert.deepEqual(recorded(configPath), moved, "the moved port was not written back");
    await serverStarted(spawned, 1);

    // A second server joins the running SFU, whose ports read as taken because it holds them.
    const second = await manager.createAndStartServer(window, "Joins", false);
    assert.equal(spawned.sfu.length, 1, "a second server started a second SFU");
    const joined = manager.getEmbeddedServerState(second.id).config;
    assert.deepEqual({ control: joined.controlPort, metrics: joined.metricsPort }, moved, "the second server recorded ports the running SFU is not on");
    assert.deepEqual(recorded(joined.configPath), moved);
    const joinedServer = await serverStarted(spawned, 2);
    assert.equal(registersOn(joinedServer), spawned.sfu[0].env.SFU_CONTROL_HOST, "a server joining the running SFU registers somewhere its control port does not listen");
    await stopAll();
  }
  await release();

  // A server created with nothing running starts the SFU on the ports this app already uses.
  {
    const { manager, spawned, stopAll } = loadManager(app);
    await manager.createAndStartServer(window, "Later", false);
    assert.deepEqual(started(spawned.sfu[0]), moved, "a new server moved the app's SFU off ports that were free");
    await serverStarted(spawned, 1);
    await stopAll();
  }

  // A config from before these lines reports the SFU's defaults, which is what its SFU took. Held, they move.
  fs.writeFileSync(configPath, fs.readFileSync(configPath, "utf8").replace(/^SFU_(CONTROL|METRICS)_PORT=.*\n/gm, ""));
  const config = loadConfigModule(app);
  const old = config.loadConfig(created.id);
  assert.deepEqual({ control: old.controlPort, metrics: old.metricsPort }, { control: 9092, metrics: 9091 });
  const releaseDefaults = [await hold(9091), await hold(9092)];
  const claimed = await config.claimSfuLocalPorts(created.id);
  for (const port of [claimed.controlPort, claimed.metricsPort]) {
    assert.ok(![9091, 9092].includes(port), `a config with no lines kept ${port}, which is taken`);
  }
  assert.notEqual(claimed.controlPort, claimed.metricsPort, "both moved onto the same free port");
  assert.deepEqual(recorded(configPath), { control: claimed.controlPort, metrics: claimed.metricsPort }, "a config with no lines did not gain them");
  for (const r of releaseDefaults) await r();
}

/* ── the SFU's own defaults, where this machine leaves them free ───────── */

const defaultsFree = [
  await canListen(9091), await canListen(9092), await canListen(9091, "127.0.0.1"), await canListen(9092, "127.0.0.1"),
].every(Boolean);
if (defaultsFree) {
  const { manager, spawned, stopAll } = loadManager(newApp());
  await manager.createAndStartServer(window, "Defaults", false);
  assert.deepEqual(started(spawned.sfu[0]), { control: 9092, metrics: 9091 }, "a lone app moved off the SFU's defaults while they were free");
  await serverStarted(spawned, 1);
  await stopAll();
} else {
  console.log("  9091 or 9092 is in use on this machine, so the free-defaults case is left to CI");
}

/* ── an SFU that loses its control port anyway is stopped before a server uses it ── */

{
  const { manager, spawned } = loadManager(newApp(), {
    onSpawn: (sfu) => queueMicrotask(() => {
      sfu.stdout.emit("data", Buffer.from("2026/09/15 12:00:00 main.go:490: ❌ Metrics listener stopped: listen tcp :9091: bind: address already in use"));
      assert.equal(sfu.killed, false, "the SFU was stopped over metrics, which nothing registers on");
      sfu.stdout.emit("data", Buffer.from("2026/09/15 12:00:00 main.go:533: ❌ Control listener stopped: listen tcp :9092: bind: address already in use"));
    }),
  });
  const state = await manager.createAndStartServer(window, "Race", false);
  await settle(0);
  const sfu = spawned.sfu[0];
  assert.equal(sfu.killed, true, "an SFU that could not bind its control port was left running");
  sfu.emit("exit", null);
  await settle(700);
  const after = manager.getEmbeddedServerState(state.id);
  assert.equal(after.status, "error", "the server did not report the SFU losing its control port");
  assert.match(after.error, /Control listener stopped/);
  assert.equal(spawned.server.length, 0, "a server was started against an SFU with no control port of its own");
  await sfu.released;
}

console.log("embedded SFU ports: each app's SFU gets free control and metrics ports, kept while free, control on loopback, and its servers go to it");
