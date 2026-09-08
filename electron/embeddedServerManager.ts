import { ChildProcess, fork, spawn } from "child_process";
import { app, BrowserWindow } from "electron";
import { existsSync, readFileSync } from "fs";
import { chmod, cp, mkdir, rename, rm, writeFile } from "fs/promises";
import { createServer } from "net";
import { join } from "path";
import { extract } from "tar";

import {
  checkPortsAvailable,
  deleteServerFiles,
  describePortConflicts,
  type EmbeddedServerConfig,
  generateConfig,
  getLanIp,
  getServerDir,
  hasExistingServer,
  isPortAvailable,
  listServerConfigs,
  listServerIds,
  loadConfig,
  suggestServerPort,
  updateCustomAdvertisedAddresses,
  updateServerPorts,
} from "./embeddedServerConfig";
import { loadGlobalStore, setGlobalValue } from "./globalStore";

export type ServerStatus = "stopped" | "starting" | "running" | "error";

export interface EmbeddedServerState {
  id: string;
  status: ServerStatus;
  config: EmbeddedServerConfig | null;
  error: string | null;
  serverUrl: string | null;
}

/** The SFU is not in here: it is one process for the whole app, routing on the
    server id, so it lives beside this map and is reference counted. */
interface Instance {
  config: EmbeddedServerConfig;
  server: ChildProcess | null;
  worker: ChildProcess | null;
  status: ServerStatus;
  error: string | null;
  /** Cancels the "assume it started" fallback if the server dies first. */
  watchdog: NodeJS.Timeout | null;
}

const instances = new Map<string, Instance>();

let sfuProcess: ChildProcess | null = null;
let sfuPort: number | null = null;
let sfuMediaPort: number | null = null;
let targetWindow: BrowserWindow | null = null;
let extractedRuntimeRoot: string | null = null;

function log(msg: string): void {
  console.log("[EmbeddedServer]", msg);
}

/** `null` is the SFU, which belongs to all of them. Without this a second server
    interleaves into the first one's pane. */
export type LogOwner = string | null;

// The children explain themselves on the way out, but that went to the main
// console while the user saw "exited unexpectedly (code 1)".
const OUTPUT_TAIL = 12;
const recentOutput = new Map<string, string[]>();

function outputKey(owner: LogOwner, source: LogSource): string {
  return `${owner ?? "-"}:${source}`;
}

function rememberOutput(owner: LogOwner, source: LogSource, msg: string): void {
  const key = outputKey(owner, source);
  const lines = recentOutput.get(key) ?? [];
  for (const line of msg.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  if (lines.length > OUTPUT_TAIL) lines.splice(0, lines.length - OUTPUT_TAIL);
  recentOutput.set(key, lines);
}

/** The most useful line from a dead process, for the error the user sees. */
function explainExit(
  owner: LogOwner,
  source: LogSource,
  code: number | null,
): string {
  const label =
    source === "sfu" ? "SFU" : source === "worker" ? "Image worker" : "Server";
  const lines = recentOutput.get(outputKey(owner, source)) ?? [];

  // Prefer a line that names the actual failure over the last line, which is
  // often a shutdown notice rather than the cause.
  const telling = [...lines]
    .reverse()
    .find((l) => /error|failed|fatal|panic|denied|refused|address already|EADDR|ENOENT/i.test(l));

  const detail = telling ?? lines[lines.length - 1];
  const base = `${label} process exited unexpectedly (code ${code})`;
  if (!detail) return base;

  // Strip the Go logger's date/time/file prefix so the message reads cleanly.
  const cleaned = detail.replace(/^\d{4}\/\d{2}\/\d{2}\s[\d:]+\s+\S+?:\d+:\s*/, "").trim();
  return `${base}: ${cleaned}`;
}

function emitStatus(): void {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("embedded-server:status-changed", getAllStates());
  }
}

export type LogLevel = "error" | "warn" | "info" | "debug";
export type LogSource = "sfu" | "server" | "worker";
export type LogLine = {
  /** The server this came from, or null for the shared SFU. */
  serverId: LogOwner;
  source: LogSource;
  level: LogLevel;
  text: string;
  at: number;
};

/** Generous, because the children are quiet normally and noisy exactly when you
    want to read them. Shared across every server. */
const LOG_HISTORY = 4000;
const logHistory: LogLine[] = [];

/**
 * None of the three emit a level, so this is pattern matching and it is wrong
 * sometimes. Structured output from each component is the only real fix.
 */
function levelOf(source: LogSource, text: string): LogLevel {
  const t = text.trim();

  // consola's symbols, which survive even when colour is stripped.
  if (/^[✖✗✕]|^\s*ERROR\b/i.test(t)) return "error";
  if (/^[⚠]|^\s*WARN(ING)?\b/i.test(t)) return "warn";
  if (/^[✔✓ℹ]|^\s*INFO\b/i.test(t)) return "info";

  // Same vocabulary explainExit already looks for, so a line that would be
  // shown as the reason a process died also reads as an error here.
  if (
    /\b(panic|fatal|error|failed|refused|denied|EADDR\w*|ENOENT)\b/i.test(t) ||
    /address already in use|bind:/i.test(t)
  ) {
    return "error";
  }
  if (/\b(warn(ing)?|deprecated|retrying)\b/i.test(t)) return "warn";
  if (/\b(debug|trace|verbose)\b/i.test(t)) return "debug";
  return "info";
}

function emitLog(owner: LogOwner, source: LogSource, data: string): void {
  const lines: LogLine[] = [];

  for (const raw of data.split("\n")) {
    // eslint-disable-next-line no-control-regex -- stripping real ANSI colour
    const text = raw.replace(/\u001b\[[0-9;]*m/g, "").trimEnd();
    if (!text.trim()) continue;
    lines.push({
      serverId: owner,
      source,
      level: levelOf(source, text),
      text,
      at: Date.now(),
    });
  }
  if (!lines.length) return;

  logHistory.push(...lines);
  if (logHistory.length > LOG_HISTORY) {
    logHistory.splice(0, logHistory.length - LOG_HISTORY);
  }

  if (targetWindow && !targetWindow.isDestroyed()) {
    // The raw payload stays for anything already listening; the parsed lines
    // are what the pane renders.
    targetWindow.webContents.send("embedded-server:log", { source, data, lines });
  }
}

/** One server plus the SFU, which carries the reason voice failed and is shared,
    so hiding it hides what the pane is usually open for. */
export function getEmbeddedServerLogs(serverId?: string): LogLine[] {
  if (!serverId) return logHistory;
  return logHistory.filter(
    (l) => l.serverId === serverId || l.serverId === null,
  );
}

export function clearEmbeddedServerLogs(serverId?: string): void {
  if (!serverId) {
    logHistory.length = 0;
    return;
  }
  for (let i = logHistory.length - 1; i >= 0; i--) {
    if (logHistory[i].serverId === serverId) logHistory.splice(i, 1);
  }
}

function setStatus(id: string, status: ServerStatus, error?: string): void {
  const inst = instances.get(id);
  if (!inst) return;
  inst.status = status;
  inst.error = error ?? null;
  emitStatus();
}

function packagedRuntimeRoot(): string | null {
  if (extractedRuntimeRoot && existsSync(extractedRuntimeRoot)) {
    return extractedRuntimeRoot;
  }

  // Compatibility with releases before the runtime was archived.
  const legacy = join(process.resourcesPath, "embedded-server");
  return existsSync(legacy) ? legacy : null;
}

/**
 * A loose dependency tree made Squirrel.Mac traverse ~14,000 files while staging
 * an update. One signed archive instead, extracted after the install.
 */
export async function prepareEmbeddedServerRuntime(): Promise<void> {
  if (!app.isPackaged) return;

  const archive = join(process.resourcesPath, "embedded-server.tar.gz");
  if (!existsSync(archive)) return;

  const runtimeParent = join(app.getPath("userData"), "embedded-runtime");
  const destination = join(runtimeParent, app.getVersion());
  const readyMarker = join(destination, ".ready");
  if (existsSync(readyMarker)) {
    extractedRuntimeRoot = destination;
    return;
  }

  const temporary = `${destination}.tmp-${process.pid}`;
  await mkdir(runtimeParent, { recursive: true });
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });

  try {
    await extract({
      cwd: temporary,
      file: archive,
      preservePaths: false,
      strict: true,
    });

    // Outside the archive so electron-builder can sign them and the notarizer
    // can inspect them, so their paths are restored after extraction.
    const nativeRoot = join(process.resourcesPath, "embedded-native");
    for (const component of ["server", "worker", "sfu"]) {
      const source = join(nativeRoot, component);
      if (existsSync(source)) {
        await cp(source, join(temporary, component), {
          recursive: true,
          force: true,
        });
      }
    }

    const sfuName = process.platform === "win32" ? "gryt_sfu.exe" : "gryt_sfu";
    const sfuPath = join(
      temporary,
      "sfu",
      process.platform === "win32" ? "win-x64" :
        `${process.platform === "darwin" ? "mac" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`,
      sfuName,
    );
    if (process.platform !== "win32" && existsSync(sfuPath)) {
      await chmod(sfuPath, 0o755);
    }

    await writeFile(join(temporary, ".ready"), `${app.getVersion()}\n`, "utf8");
    await rm(destination, { recursive: true, force: true });
    await rename(temporary, destination);
    extractedRuntimeRoot = destination;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function getServerBundlePath(): string | null {
  const bundleName = "bundle.js";
  const runtimeRoot = packagedRuntimeRoot();
  const packaged = runtimeRoot ? join(runtimeRoot, "server", bundleName) : null;
  const dev = join(app.getAppPath(), "build", "embedded-server", "server", bundleName);
  if (packaged && existsSync(packaged)) return packaged;
  if (existsSync(dev)) return dev;
  return null;
}

/** Without this the embedded server falls back to "1.0.0" and reports that
    beside a real latest-release number, looking permanently out of date. */
function readBundledVersions(): { server?: string; sfu?: string; worker?: string } {
  const runtimeRoot = packagedRuntimeRoot();
  const packaged = runtimeRoot ? join(runtimeRoot, "versions.json") : null;
  const dev = join(app.getAppPath(), "build", "embedded-server", "versions.json");
  const path = packaged && existsSync(packaged) ? packaged : existsSync(dev) ? dev : null;
  if (!path) return {};

  try {
    return JSON.parse(readFileSync(path, "utf8")) as {
      server?: string;
      sfu?: string;
      worker?: string;
    };
  } catch {
    return {};
  }
}

function getWorkerEntryPath(): string | null {
  const entry = join("worker", "dist", "index.js");
  const runtimeRoot = packagedRuntimeRoot();
  const packaged = runtimeRoot ? join(runtimeRoot, entry) : null;
  const dev = join(app.getAppPath(), "build", "embedded-server", entry);
  if (packaged && existsSync(packaged)) return packaged;
  if (existsSync(dev)) return dev;
  return null;
}

function getSfuBinaryPath(): string | null {
  const ext = process.platform === "win32" ? ".exe" : "";
  const name = `gryt_sfu${ext}`;
  const ebOs = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  const ebArch = process.arch === "arm64" ? "arm64" : "x64";
  const runtimeRoot = packagedRuntimeRoot();
  const packaged = runtimeRoot ? join(runtimeRoot, "sfu", name) : null;
  const archived = runtimeRoot ? join(runtimeRoot, "sfu", `${ebOs}-${ebArch}`, name) : null;
  const dev = join(app.getAppPath(), "build", "embedded-server", "sfu",
    `${ebOs}-${ebArch}`, name);
  if (packaged && existsSync(packaged)) return packaged;
  if (archived && existsSync(archived)) return archived;
  if (existsSync(dev)) return dev;
  return null;
}

export function isEmbeddedServerAvailable(): boolean {
  return getServerBundlePath() !== null && getSfuBinaryPath() !== null;
}

function stateOf(inst: Instance): EmbeddedServerState {
  return {
    id: inst.config.id,
    status: inst.status,
    config: inst.config,
    error: inst.error,
    serverUrl: `http://127.0.0.1:${inst.config.serverPort}`,
  };
}

/** From disk rather than the map, which only holds the ones touched this
    session. */
export function getAllStates(): EmbeddedServerState[] {
  const states: EmbeddedServerState[] = [];

  for (const config of listServerConfigs()) {
    const inst = instances.get(config.id);
    if (inst) {
      states.push(stateOf(inst));
    } else {
      states.push({
        id: config.id,
        status: "stopped",
        config,
        error: null,
        serverUrl: `http://127.0.0.1:${config.serverPort}`,
      });
    }
  }

  return states;
}

export function getEmbeddedServerState(id: string): EmbeddedServerState | null {
  const inst = instances.get(id);
  if (inst) return stateOf(inst);

  const config = loadConfig(id);
  if (!config) return null;

  return {
    id,
    status: "stopped",
    config,
    error: null,
    serverUrl: `http://127.0.0.1:${config.serverPort}`,
  };
}

/** Stopped only: the running processes hold the old ports, so a change would
    take effect on a restart that finds the numbers in use. */
export async function updateServerPortsFor(
  id: string,
  ports: { serverPort?: number; sfuPort?: number; mediaPort?: number },
): Promise<EmbeddedServerState | null> {
  const current = getEmbeddedServerState(id);
  if (!current) return null;
  if (current.status === "running" || current.status === "starting") {
    throw new Error("Stop the server before changing its ports");
  }

  const config = await updateServerPorts(id, ports);
  if (!config) return null;

  const inst = instances.get(id);
  if (inst) inst.config = config;
  emitStatus();
  return getEmbeddedServerState(id);
}

export function updateServerAdvertisedAddresses(
  id: string,
  addresses: string[],
): EmbeddedServerState | null {
  const current = getEmbeddedServerState(id);
  if (!current) return null;
  if (current.status === "running" || current.status === "starting") {
    throw new Error("Stop the server before changing its advertised addresses");
  }

  const config = updateCustomAdvertisedAddresses(id, addresses);
  if (!config) return null;

  const inst = instances.get(id);
  if (inst) inst.config = config;
  emitStatus();
  return getEmbeddedServerState(id);
}

function parseEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }

  return env;
}

/** How many servers are relying on the SFU right now. */
function sfuUsers(): number {
  let n = 0;
  for (const inst of instances.values()) {
    if (inst.status === "running" || inst.status === "starting") n++;
  }
  return n;
}

function spawnSfu(config: EmbeddedServerConfig): ChildProcess | null {
  const binary = getSfuBinaryPath();
  if (!binary) return null;
  const envVars = parseEnvFile(config.configPath);

  // The SFU reads config.env relative to its own cwd, so anything not named here
  // it never sees — ICE_UDP_MUX_PORT most of all, or media lands anywhere.
  const proc = spawn(binary, [], {
    env: {
      ...process.env,
      PORT: String(config.sfuPort),
      SFU_PORT: String(config.sfuPort),
      ICE_UDP_MUX_PORT: String(config.mediaPort),
      ICE_ADVERTISE_IP: envVars.ICE_ADVERTISE_IP || "",
      ...(envVars.STUN_SERVERS ? { STUN_SERVERS: envVars.STUN_SERVERS } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const onOutput = (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput(null, "sfu", msg);
      log(`[SFU] ${msg}`);
      emitLog(null, "sfu", msg);
    }
  };

  proc.stdout?.on("data", onOutput);
  proc.stderr?.on("data", onOutput);

  proc.on("exit", (code) => {
    log(`SFU exited with code ${code}`);
    sfuProcess = null;
    sfuPort = null;
    sfuMediaPort = null;

    // The SFU is shared, so its death is everybody's: any server still up now has
    // voice that cannot work.
    for (const inst of instances.values()) {
      if (inst.status === "running" || inst.status === "starting") {
        setStatus(inst.config.id, "error", explainExit(null, "sfu", code));
        stopServer(inst.config.id);
      }
    }
  });

  return proc;
}

/** One process for every server: a second would compete for the port, and
    whichever lost would take the server that spawned it down. */
function ensureSfu(config: EmbeddedServerConfig): number | null {
  if (sfuProcess && sfuPort !== null) return sfuPort;

  sfuProcess = spawnSfu(config);
  if (!sfuProcess) return null;

  sfuPort = config.sfuPort;
  sfuMediaPort = config.mediaPort;
  log(
    `SFU started (pid=${sfuProcess.pid}, signalling=tcp/${sfuPort}, media=udp/${sfuMediaPort})`,
  );
  return sfuPort;
}

/** Shut the SFU down once the last server using it has gone. */
function releaseSfu(): void {
  if (sfuUsers() > 0) return;
  if (!sfuProcess) return;

  log("Last server stopped — shutting the SFU down");
  killProcess(sfuProcess);
  sfuProcess = null;
  sfuPort = null;
  sfuMediaPort = null;
}

function spawnServer(
  config: EmbeddedServerConfig,
  workerHealthPort: number | null,
): ChildProcess | null {
  const bundlePath = getServerBundlePath();
  if (!bundlePath) return null;

  const envVars = parseEnvFile(config.configPath);
  const versions = readBundledVersions();
  const id = config.id;

  const proc = fork(bundlePath, [], {
    env: {
      ...process.env,
      ...envVars,
      NODE_ENV: "production",
      ...(versions.server ? { SERVER_VERSION: versions.server } : {}),
      // The server has to ask the worker what it is, so the port is picked before
      // the fork rather than inside spawnWorker.
      ...(workerHealthPort
        ? { IMAGE_WORKER_URL: `http://127.0.0.1:${workerHealthPort}` }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    // dotenv reads config.env relative to cwd, so a shared one has both servers
    // reading the first's file, and a key absent from one leaks across.
    cwd: getServerDir(id),
    silent: true,
  });

  proc.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput(id, "server", msg);
      log(`[Server ${id}] ${msg}`);
      emitLog(id, "server", msg);

      const inst = instances.get(id);
      if (
        inst?.status === "starting" &&
        (msg.includes("listening on") ||
          msg.includes("Server running") ||
          msg.includes(`:${config.serverPort}`))
      ) {
        setStatus(id, "running");
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput(id, "server", msg);
      log(`[Server ${id}] ${msg}`);
      emitLog(id, "server", msg);
    }
  });

  proc.on("exit", (code) => {
    log(`Server ${id} exited with code ${code}`);
    const inst = instances.get(id);
    if (!inst) return;

    inst.server = null;
    if (inst.status === "running" || inst.status === "starting") {
      setStatus(id, "error", explainExit(id, "server", code));
      stopServer(id);
    }
  });

  return proc;
}

/** A port nothing is listening on, for the worker's health endpoint. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
    });
  });
}

/**
 * Separate on purpose: it hands stranger-uploaded bytes to libvips, and a corrupt
 * image must not take down the process holding the signing keys. One per server,
 * since it opens one DATA_DIR, and its death is not the server's.
 */
function spawnWorker(
  config: EmbeddedServerConfig,
  healthPort: number | null,
): ChildProcess | null {
  const entry = getWorkerEntryPath();
  if (!entry) {
    log("Image worker not bundled — image jobs will not be processed");
    return null;
  }
  if (!healthPort) {
    log("No free port for the image worker's health endpoint — not starting it");
    return null;
  }

  const envVars = parseEnvFile(config.configPath);
  const id = config.id;

  const proc = fork(entry, [], {
    env: {
      ...process.env,
      ...envVars,
      NODE_ENV: "production",
      HEALTH_PORT: String(healthPort),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    cwd: getServerDir(id),
    silent: true,
  });

  const onOutput = (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput(id, "worker", msg);
      log(`[Worker ${id}] ${msg}`);
      emitLog(id, "worker", msg);
    }
  };

  proc.stdout?.on("data", onOutput);
  proc.stderr?.on("data", onOutput);

  proc.on("exit", (code) => {
    log(`Image worker for ${id} exited with code ${code}`);
    const inst = instances.get(id);
    if (inst) inst.worker = null;
    // Deliberately does not touch status or stop anything else.
  });

  return proc;
}

export { isPortAvailable, suggestServerPort };

export async function createAndStartServer(
  window: BrowserWindow,
  serverName: string,
  lanDiscoverable: boolean,
  requestedPort?: number,
): Promise<EmbeddedServerState | null> {
  targetWindow = window;

  try {
    const config = await generateConfig(serverName, lanDiscoverable, requestedPort);
    instances.set(config.id, {
      config,
      server: null,
      worker: null,
      status: "starting",
      error: null,
      watchdog: null,
    });
    setAutoStart(config.id, true);
    emitStatus();
    return startProcesses(config.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Create failed: ${msg}`);
    return null;
  }
}

export async function startExistingServer(
  window: BrowserWindow,
  id: string,
): Promise<EmbeddedServerState | null> {
  targetWindow = window;

  const existing = instances.get(id);
  if (existing && (existing.status === "running" || existing.status === "starting")) {
    return stateOf(existing);
  }

  // Refuse rather than move: a relocated port looks healthy and is fatal for
  // anybody who forwarded the old one. SFU ports are pinned when one is up.
  try {
    const conflicts = await checkPortsAvailable(
      id,
      sfuPort ?? undefined,
      sfuMediaPort ?? undefined,
    );

    if (conflicts.length > 0) {
      const message = describePortConflicts(conflicts);
      log(`${id}: ${message}`);

      // Recorded against the instance so the card shows it, or the server sits at
      // "stopped" with nothing said.
      const conflicted = loadConfig(id);
      if (!conflicted) return null;

      if (!instances.has(id)) {
        instances.set(id, {
          config: conflicted,
          server: null,
          worker: null,
          status: "error",
          error: message,
          watchdog: null,
        });
        emitStatus();
      } else {
        setStatus(id, "error", message);
      }

      return getEmbeddedServerState(id);
    }
  } catch (err) {
    log(`Port check failed: ${err instanceof Error ? err.message : err}`);
  }

  const config = loadConfig(id);
  if (!config) return null;

  instances.set(id, {
    config,
    server: null,
    worker: null,
    status: "starting",
    error: null,
    watchdog: null,
  });
  emitStatus();

  return startProcesses(id);
}

function startProcesses(id: string): EmbeddedServerState | null {
  const inst = instances.get(id);
  if (!inst) return null;

  const config = inst.config;

  if (ensureSfu(config) === null) {
    setStatus(id, "error", "Failed to start SFU (binary not found)");
    return stateOf(inst);
  }

  // Small delay to let SFU bind its port before the server connects. Skipped
  // when it was already up, since there is nothing to wait for.
  const delay = sfuUsers() > 1 ? 0 : 500;

  setTimeout(async () => {
    const current = instances.get(id);
    if (!current || current.status !== "starting") return;

    // Picked before the fork, because the server has to be told where to find it.
    // Failing costs the version readout, not the worker.
    let workerHealthPort: number | null = null;
    try {
      workerHealthPort = await findFreePort();
    } catch {
      log("Could not find a free port for the image worker");
    }

    current.server = spawnServer(config, workerHealthPort);
    if (!current.server) {
      setStatus(id, "error", "Failed to start server (bundle not found)");
      releaseSfu();
      return;
    }
    log(`Server ${id} started (pid=${current.server.pid}, port=${config.serverPort})`);

    // After the server, whose database it polls. Not fatal, so nothing waits on
    // it or fails the start over it.
    try {
      current.worker = spawnWorker(config, workerHealthPort);
      if (current.worker) log(`Image worker for ${id} started (pid=${current.worker.pid})`);
    } catch (err) {
      log(`Image worker failed to start: ${err instanceof Error ? err.message : err}`);
    }

    // If no "listening" log within 10 seconds, assume it's running anyway
    current.watchdog = setTimeout(() => {
      const later = instances.get(id);
      if (later?.status === "starting") setStatus(id, "running");
    }, 10_000);
  }, delay);

  return stateOf(inst);
}

function killProcess(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      proc.kill("SIGTERM");
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, 3000);
    }
  } catch {
    /* already exited */
  }
}

export function stopServer(id: string): EmbeddedServerState | null {
  const inst = instances.get(id);
  if (!inst) return null;

  log(`Stopping embedded server ${id}...`);

  if (inst.watchdog) {
    clearTimeout(inst.watchdog);
    inst.watchdog = null;
  }

  killProcess(inst.worker);
  inst.worker = null;

  killProcess(inst.server);
  inst.server = null;

  if (inst.status !== "error") {
    setStatus(id, "stopped");
  }

  // After the status change, so this server no longer counts itself as a user.
  releaseSfu();

  return stateOf(inst);
}

/** Stops and waits, since SQLite holds its file open and removing the directory
    leaves a server writing into nothing. The auto-start entry goes too. */
export async function deleteServer(id: string): Promise<EmbeddedServerState[]> {
  const inst = instances.get(id);

  if (inst) {
    stopServer(id);
    // A moment for the child processes to actually exit and release the file.
    await new Promise((resolve) => setTimeout(resolve, 500));
    instances.delete(id);
  }

  setAutoStart(id, false);
  deleteServerFiles(id);

  for (let i = logHistory.length - 1; i >= 0; i--) {
    if (logHistory[i].serverId === id) logHistory.splice(i, 1);
  }

  emitStatus();
  return getAllStates();
}

export function stopAllServers(): void {
  for (const id of [...instances.keys()]) stopServer(id);
  releaseSfu();
}

/** Not stop, which guards `if (status !== "error")` so a dying process cannot
    overwrite its reason — and so refused the one button meant to clear it. */
export function dismissEmbeddedServerError(id: string): EmbeddedServerState | null {
  const inst = instances.get(id);
  if (!inst) return null;

  if (inst.status === "error") {
    setStatus(id, "stopped");
  }

  return stateOf(inst);
}

export function getEmbeddedServerInfo(): {
  available: boolean;
  hasExisting: boolean;
  lanIp: string;
  servers: EmbeddedServerState[];
  bundled: { server?: string; sfu?: string; worker?: string };
} {
  return {
    available: isEmbeddedServerAvailable(),
    hasExisting: hasExistingServer(),
    lanIp: getLanIp(),
    servers: getAllStates(),
    // What this app ships, not what a server it is connected to runs. A bug
    // report needs both, and the renderer cannot see this one otherwise.
    bundled: readBundledVersions(),
  };
}

const AUTO_START_KEY = "embeddedServer.autoStart";

/** Nothing migrates the old boolean, which was dropped while this was beta.
    People host real servers now, so the next change to this key needs one. */
function autoStartIds(): string[] {
  const store = loadGlobalStore();
  const raw = store[AUTO_START_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export function getAutoStart(id: string): boolean {
  return autoStartIds().includes(id);
}

export function setAutoStart(id: string, enabled: boolean): void {
  const current = new Set(autoStartIds());
  if (enabled) current.add(id);
  else current.delete(id);
  setGlobalValue(AUTO_START_KEY, [...current]);
}

export async function autoStartIfNeeded(window: BrowserWindow): Promise<void> {
  if (!isEmbeddedServerAvailable()) return;

  const wanted = autoStartIds().filter((id) => listServerIds().includes(id));
  if (wanted.length === 0) return;

  targetWindow = window;

  // In sequence: they contend for ports, and the first to start decides which
  // one the shared SFU is on.
  for (const id of wanted) {
    log(`Auto-starting ${id} from previous session...`);
    await startExistingServer(window, id);
  }
}

export function cleanupOnQuit(): void {
  stopAllServers();
}
