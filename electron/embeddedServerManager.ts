import { ChildProcess, fork, spawn } from "child_process";
import { app, BrowserWindow } from "electron";
import { existsSync, readFileSync } from "fs";
import { createServer } from "net";
import { join } from "path";

import {
  type EmbeddedServerConfig,
  ensurePortsAvailable,
  generateConfig,
  getEmbeddedServerDir,
  getLanIp,
  hasExistingServer,
  loadExistingConfig,
} from "./embeddedServerConfig";
import { loadGlobalStore, setGlobalValue } from "./globalStore";

export type ServerStatus = "stopped" | "starting" | "running" | "error";

export interface EmbeddedServerState {
  status: ServerStatus;
  config: EmbeddedServerConfig | null;
  error: string | null;
  serverUrl: string | null;
}

let serverProcess: ChildProcess | null = null;
let sfuProcess: ChildProcess | null = null;
let workerProcess: ChildProcess | null = null;
let currentConfig: EmbeddedServerConfig | null = null;
let currentStatus: ServerStatus = "stopped";
let currentError: string | null = null;
let targetWindow: BrowserWindow | null = null;

function log(msg: string): void {
  console.log("[EmbeddedServer]", msg);
}

// Both child processes explain themselves perfectly well on the way out — the
// SFU prints "listen tcp :5005: bind: address already in use" — but that went
// to the main process console while the user was shown "exited unexpectedly
// (code 1)" and nothing else. Keep the tail so the error can say why.
const OUTPUT_TAIL = 12;
const recentOutput: Record<"sfu" | "server" | "worker", string[]> = {
  sfu: [],
  server: [],
  worker: [],
};

function rememberOutput(source: "sfu" | "server" | "worker", msg: string): void {
  const lines = recentOutput[source];
  for (const line of msg.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) lines.push(trimmed);
  }
  if (lines.length > OUTPUT_TAIL) lines.splice(0, lines.length - OUTPUT_TAIL);
}

/** The most useful line from a dead process, for the error the user sees. */
function explainExit(
  source: "sfu" | "server" | "worker",
  code: number | null,
): string {
  const label =
    source === "sfu" ? "SFU" : source === "worker" ? "Image worker" : "Server";
  const lines = recentOutput[source];

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
    targetWindow.webContents.send("embedded-server:status-changed", getState());
  }
}

function emitLog(source: string, data: string): void {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("embedded-server:log", { source, data });
  }
}

function setStatus(status: ServerStatus, error?: string): void {
  currentStatus = status;
  currentError = error ?? null;
  emitStatus();
}

function getServerBundlePath(): string | null {
  const bundleName = "bundle.js";
  const packaged = join(process.resourcesPath, "embedded-server", "server", bundleName);
  const dev = join(app.getAppPath(), "build", "embedded-server", "server", bundleName);
  if (existsSync(packaged)) return packaged;
  if (existsSync(dev)) return dev;
  return null;
}

/**
 * What the build put in the bundle, written by build-embedded-server.mjs.
 *
 * Without this the embedded server falls back to the hardcoded "1.0.0" in its
 * own config, and every desktop-hosted server reports that next to a real
 * latest-release number — so it looks permanently, wrongly out of date.
 */
function readBundledVersions(): { server?: string; sfu?: string; worker?: string } {
  const packaged = join(process.resourcesPath, "embedded-server", "versions.json");
  const dev = join(app.getAppPath(), "build", "embedded-server", "versions.json");
  const path = existsSync(packaged) ? packaged : existsSync(dev) ? dev : null;
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
  const packaged = join(process.resourcesPath, "embedded-server", entry);
  const dev = join(app.getAppPath(), "build", "embedded-server", entry);
  if (existsSync(packaged)) return packaged;
  if (existsSync(dev)) return dev;
  return null;
}

function getSfuBinaryPath(): string | null {
  const ext = process.platform === "win32" ? ".exe" : "";
  const name = `gryt_sfu${ext}`;
  const packaged = join(process.resourcesPath, "embedded-server", "sfu", name);
  const ebOs = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  const ebArch = process.arch === "arm64" ? "arm64" : "x64";
  const dev = join(app.getAppPath(), "build", "embedded-server", "sfu",
    `${ebOs}-${ebArch}`, name);
  if (existsSync(packaged)) return packaged;
  if (existsSync(dev)) return dev;
  return null;
}

export function isEmbeddedServerAvailable(): boolean {
  return getServerBundlePath() !== null && getSfuBinaryPath() !== null;
}

export function getState(): EmbeddedServerState {
  return {
    status: currentStatus,
    config: currentConfig,
    error: currentError,
    serverUrl: currentConfig ? `http://127.0.0.1:${currentConfig.serverPort}` : null,
  };
}

function parseEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  const raw = readFileSync(path, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

function spawnSfu(config: EmbeddedServerConfig): ChildProcess | null {
  const sfuPath = getSfuBinaryPath();
  if (!sfuPath) return null;

  const envVars = parseEnvFile(config.configPath);

  const proc = spawn(sfuPath, [], {
    env: {
      ...process.env,
      ...envVars,
      PORT: String(config.sfuPort),
      SFU_PORT: String(config.sfuPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: getEmbeddedServerDir(),
  });

  const onSfuOutput = (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput("sfu", msg);
      log(`[SFU] ${msg}`);
      emitLog("sfu", msg);
    }
  };

  proc.stdout?.on("data", onSfuOutput);
  proc.stderr?.on("data", onSfuOutput);

  proc.on("exit", (code) => {
    log(`SFU exited with code ${code}`);
    sfuProcess = null;
    if (currentStatus === "running" || currentStatus === "starting") {
      setStatus("error", explainExit("sfu", code));
      stopEmbeddedServer();
    }
  });

  return proc;
}

function spawnServer(
  config: EmbeddedServerConfig,
  workerHealthPort: number | null,
): ChildProcess | null {
  const bundlePath = getServerBundlePath();
  if (!bundlePath) return null;

  const envVars = parseEnvFile(config.configPath);
  const versions = readBundledVersions();

  const proc = fork(bundlePath, [], {
    env: {
      ...process.env,
      ...envVars,
      NODE_ENV: "production",
      ...(versions.server ? { SERVER_VERSION: versions.server } : {}),
      // The worker is a separate process, so the server has to ask it what it
      // is. It cannot ask if it does not know where — and the port is picked
      // here, which is why it is chosen before the server is forked rather than
      // inside spawnWorker where it used to be.
      ...(workerHealthPort
        ? { IMAGE_WORKER_URL: `http://127.0.0.1:${workerHealthPort}` }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    cwd: getEmbeddedServerDir(),
    silent: true,
  });

  proc.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput("server", msg);
      log(`[Server] ${msg}`);
      emitLog("server", msg);
      if (msg.includes("listening on") || msg.includes("Server running") || msg.includes(`:${config.serverPort}`)) {
        if (currentStatus === "starting") {
          setStatus("running");
        }
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput("server", msg);
      log(`[Server] ${msg}`);
      emitLog("server", msg);
    }
  });

  proc.on("exit", (code) => {
    log(`Server exited with code ${code}`);
    serverProcess = null;
    if (currentStatus === "running" || currentStatus === "starting") {
      setStatus("error", explainExit("server", code));
      stopEmbeddedServer();
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
 * The image worker, as its own process.
 *
 * A server hosted from the desktop app queues image jobs like any other. Without
 * this, nothing ever reads them: no thumbnails, no dominant colours, and —
 * because the upload route skips the size limit for images on the assumption
 * something will shrink them later — uploads that stay at full size on the
 * host's own disk forever.
 *
 * Separate rather than folded into the server on purpose. It hands
 * stranger-uploaded bytes to libvips, and the reason the worker exists at all is
 * that a corrupt image should not be able to take down the process holding the
 * signing keys and every socket. Bundling it must not quietly undo that.
 *
 * Its failure is not the server's failure. If this dies the server keeps
 * running, images simply stop being processed — which is exactly the state
 * every desktop-hosted server was in before it existed.
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

  const proc = fork(entry, [], {
    env: {
      ...process.env,
      ...envVars,
      NODE_ENV: "production",
      HEALTH_PORT: String(healthPort),
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    cwd: getEmbeddedServerDir(),
    silent: true,
  });

  const onOutput = (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      rememberOutput("worker", msg);
      log(`[Worker] ${msg}`);
      emitLog("worker", msg);
    }
  };

  proc.stdout?.on("data", onOutput);
  proc.stderr?.on("data", onOutput);

  proc.on("exit", (code) => {
    log(`Image worker exited with code ${code}`);
    workerProcess = null;
    // Deliberately does not touch status or stop anything else.
  });

  return proc;
}

export async function createAndStartServer(
  window: BrowserWindow,
  serverName: string,
  lanDiscoverable: boolean,
): Promise<EmbeddedServerState> {
  targetWindow = window;

  if (currentStatus === "running" || currentStatus === "starting") {
    return getState();
  }

  setStatus("starting");

  try {
    currentConfig = await generateConfig(serverName, lanDiscoverable);
    setAutoStart(true);
    return startProcesses();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`Create failed: ${msg}`);
    setStatus("error", msg);
    return getState();
  }
}

export async function startExistingServer(
  window: BrowserWindow,
): Promise<EmbeddedServerState> {
  targetWindow = window;

  if (currentStatus === "running" || currentStatus === "starting") {
    return getState();
  }

  // Ports were picked when the server was created and never re-checked. Move
  // off any that have since been taken, before loading the config — otherwise
  // the process just fails to bind and exits, every time, unrecoverably.
  try {
    const moved = await ensurePortsAvailable();
    for (const note of moved) log(note);
  } catch (err) {
    log(`Port re-check failed: ${err instanceof Error ? err.message : err}`);
  }

  const config = loadExistingConfig();
  if (!config) {
    setStatus("error", "No existing server configuration found");
    return getState();
  }

  setStatus("starting");
  currentConfig = config;
  return startProcesses();
}

function startProcesses(): EmbeddedServerState {
  if (!currentConfig) {
    setStatus("error", "No configuration");
    return getState();
  }

  sfuProcess = spawnSfu(currentConfig);
  if (!sfuProcess) {
    setStatus("error", "Failed to start SFU (binary not found)");
    return getState();
  }
  log(`SFU started (pid=${sfuProcess.pid}, port=${currentConfig.sfuPort})`);

  // Small delay to let SFU bind its port before the server connects
  setTimeout(async () => {
    if (!currentConfig || currentStatus !== "starting") return;

    // The worker's health port is picked before the server is forked rather
    // than when the worker starts, because the server has to be told where to
    // find it and only exists once. Failing to find one costs the version
    // readout, not the worker — see spawnWorker.
    let workerHealthPort: number | null = null;
    try {
      workerHealthPort = await findFreePort();
    } catch {
      log("Could not find a free port for the image worker");
    }

    serverProcess = spawnServer(currentConfig, workerHealthPort);
    if (!serverProcess) {
      setStatus("error", "Failed to start server (bundle not found)");
      killProcess(sfuProcess);
      sfuProcess = null;
      return;
    }
    log(`Server started (pid=${serverProcess.pid}, port=${currentConfig.serverPort})`);

    // After the server, because it polls a database the server creates. Its
    // absence is not fatal — see spawnWorker — so nothing here waits on it or
    // fails the start over it.
    try {
      workerProcess = spawnWorker(currentConfig, workerHealthPort);
      if (workerProcess) log(`Image worker started (pid=${workerProcess.pid})`);
    } catch (err) {
      log(`Image worker failed to start: ${err instanceof Error ? err.message : err}`);
    }

    // If no "listening" log within 10 seconds, assume it's running anyway
    setTimeout(() => {
      if (currentStatus === "starting") {
        setStatus("running");
      }
    }, 10_000);
  }, 500);

  return getState();
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

export function stopEmbeddedServer(): void {
  log("Stopping embedded server...");

  killProcess(workerProcess);
  workerProcess = null;

  killProcess(serverProcess);
  serverProcess = null;

  killProcess(sfuProcess);
  sfuProcess = null;

  if (currentStatus !== "error") {
    setStatus("stopped");
  }
}

/**
 * Clear a failure the user has read, without touching the processes.
 *
 * Dismissing used to call stopEmbeddedServer(), which cannot work: that guards
 * `if (currentStatus !== "error")` so a dying process does not overwrite the
 * reason it died with a bare "stopped". Correct for that job, but it meant the
 * button pressed to clear an error was the one call that refused to clear it.
 */
export function dismissEmbeddedServerError(): EmbeddedServerState {
  if (currentStatus === "error") {
    setStatus("stopped");
  }

  return getState();
}

export function getEmbeddedServerInfo(): {
  available: boolean;
  hasExisting: boolean;
  config: EmbeddedServerConfig | null;
  lanIp: string;
} {
  return {
    available: isEmbeddedServerAvailable(),
    hasExisting: hasExistingServer(),
    config: loadExistingConfig(),
    lanIp: getLanIp(),
  };
}

export function setAutoStart(enabled: boolean): void {
  setGlobalValue("embeddedServer.autoStart", enabled);
}

export function getAutoStart(): boolean {
  const store = loadGlobalStore();
  return store["embeddedServer.autoStart"] === true;
}

export async function autoStartIfNeeded(window: BrowserWindow): Promise<void> {
  if (!getAutoStart()) return;
  if (!isEmbeddedServerAvailable()) return;
  if (!hasExistingServer()) return;

  log("Auto-starting server from previous session...");
  targetWindow = window;
  await startExistingServer(window);
}

export function cleanupOnQuit(): void {
  stopEmbeddedServer();
}
