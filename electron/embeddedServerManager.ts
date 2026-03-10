import { ChildProcess, fork, spawn } from "child_process";
import { app, BrowserWindow } from "electron";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import {
  type EmbeddedServerConfig,
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
let currentConfig: EmbeddedServerConfig | null = null;
let currentStatus: ServerStatus = "stopped";
let currentError: string | null = null;
let targetWindow: BrowserWindow | null = null;

function log(msg: string): void {
  console.log("[EmbeddedServer]", msg);
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

  proc.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      log(`[SFU] ${msg}`);
      emitLog("sfu", msg);
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
      log(`[SFU] ${msg}`);
      emitLog("sfu", msg);
    }
  });

  proc.on("exit", (code) => {
    log(`SFU exited with code ${code}`);
    sfuProcess = null;
    if (currentStatus === "running" || currentStatus === "starting") {
      setStatus("error", `SFU process exited unexpectedly (code ${code})`);
      stopEmbeddedServer();
    }
  });

  return proc;
}

function spawnServer(config: EmbeddedServerConfig): ChildProcess | null {
  const bundlePath = getServerBundlePath();
  if (!bundlePath) return null;

  const envVars = parseEnvFile(config.configPath);

  const proc = fork(bundlePath, [], {
    env: {
      ...process.env,
      ...envVars,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    cwd: getEmbeddedServerDir(),
    silent: true,
  });

  proc.stdout?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) {
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
      log(`[Server] ${msg}`);
      emitLog("server", msg);
    }
  });

  proc.on("exit", (code) => {
    log(`Server exited with code ${code}`);
    serverProcess = null;
    if (currentStatus === "running" || currentStatus === "starting") {
      setStatus("error", `Server process exited unexpectedly (code ${code})`);
      stopEmbeddedServer();
    }
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
  setTimeout(() => {
    if (!currentConfig || currentStatus !== "starting") return;

    serverProcess = spawnServer(currentConfig);
    if (!serverProcess) {
      setStatus("error", "Failed to start server (bundle not found)");
      killProcess(sfuProcess);
      sfuProcess = null;
      return;
    }
    log(`Server started (pid=${serverProcess.pid}, port=${currentConfig.serverPort})`);

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

  killProcess(serverProcess);
  serverProcess = null;

  killProcess(sfuProcess);
  sfuProcess = null;

  if (currentStatus !== "error") {
    setStatus("stopped");
  }
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
