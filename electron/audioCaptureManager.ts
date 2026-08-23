/**
 * Manages the native subprocesses that capture audio for a screen share and
 * forwards their PCM to the renderer over IPC.
 *
 * Each process captures one thing, because that is what the OS APIs offer:
 *
 *   "exclude" — everything except Gryt's process tree
 *   "include" — one application's process tree, and nothing else
 *
 * Windows:  WASAPI PROCESS_LOOPBACK_MODE_{INCLUDE,EXCLUDE}_TARGET_PROCESS_TREE
 * macOS:    ScreenCaptureKit excludesCurrentProcessAudio
 *
 * A process loopback client activates against a single PID, so capturing two
 * applications means two processes. Their PCM is summed here (audioMixer.ts)
 * and leaves as one stream, which is what the renderer already reads.
 *
 * macOS ignores the PID it is handed and captures the machine either way, so
 * choosing applications is Windows only — `supportsPerApplicationAudio` is
 * what the UI asks before offering it.
 */

import { ChildProcess, execFileSync, spawn } from "child_process";
import { app, BrowserWindow } from "electron";
import { existsSync } from "fs";
import { join } from "path";

import { AudioMixer } from "./audioMixer";
import { type CapturePlan, planCaptureChange, SYSTEM_AUDIO_SOURCE_ID } from "./captureSet";

interface Capture {
  proc: ChildProcess;
  bytes: number;
  chunks: number;
}

/** Capture key for one application's process tree. */
function pidKey(pid: number): string {
  return `pid:${pid}`;
}

const captures = new Map<string, Capture>();
const mixer = new AudioMixer();

/**
 * The window source ids the renderer last asked for, which is what it gets
 * back. Captures are keyed by process id underneath — two windows of the same
 * application are one capture — so the two lists are not the same shape.
 */
let requestedSources: string[] = [];
let diagnosticWindow: BrowserWindow | null = null;
let statsInterval: ReturnType<typeof setInterval> | null = null;

function sendDiag(msg: string): void {
  try {
    if (diagnosticWindow && !diagnosticWindow.isDestroyed()) {
      diagnosticWindow.webContents.send("native-audio-diagnostic", msg);
    }
  } catch {
    // Window might be mid-destruction
  }
  console.log("[NativeAudioCapture]", msg);
}

function getNativeBinaryPath(): string | null {
  const platform = process.platform;
  let binaryName: string;

  if (platform === "win32") {
    binaryName = "audio-capture.exe";
  } else if (platform === "darwin") {
    binaryName = "audio-capture";
  } else {
    return null;
  }

  const resourcePath = app.isPackaged
    ? join(process.resourcesPath, "native", binaryName)
    : join(app.getAppPath(), "build", "native", binaryName);

  return existsSync(resourcePath) ? resourcePath : null;
}

/**
 * Resolve an Electron desktopCapturer window source ID to a process ID.
 * Source IDs look like "window:<HWND>:0".
 */
function resolveWindowPid(sourceId: string): number | null {
  const binaryPath = getNativeBinaryPath();
  if (!binaryPath) return null;

  const match = sourceId.match(/^window:(\d+):/);
  if (!match) return null;
  const hwnd = match[1];

  try {
    const stdout = execFileSync(binaryPath, ["pid-of", hwnd], {
      timeout: 3000,
      windowsHide: true,
    });
    const pid = parseInt(stdout.toString().trim(), 10);
    return pid > 0 ? pid : null;
  } catch (err) {
    console.warn("[NativeAudioCapture] failed to resolve HWND to PID:", err);
    return null;
  }
}

export function isNativeAudioCaptureAvailable(): boolean {
  const path = getNativeBinaryPath();
  console.log(`[NativeAudioCapture] available check: binary=${path ?? "NOT FOUND"}`);
  return path !== null;
}

/**
 * Whether audio can be taken from named applications rather than from the
 * machine. Windows only: the macOS helper takes a PID argument and ignores it.
 */
export function supportsPerApplicationAudio(): boolean {
  return process.platform === "win32" && isNativeAudioCaptureAvailable();
}

function startStats(): void {
  if (statsInterval) return;

  statsInterval = setInterval(() => {
    if (captures.size === 0) return;

    const parts = [...captures.entries()].map(([id, c]) => {
      const dropped = mixer.droppedBytes(id);
      return `${id}: ${c.chunks} chunks, ${(c.bytes / 1024).toFixed(0)} KB${
        dropped > 0 ? `, ${(dropped / 1024).toFixed(0)} KB dropped` : ""
      }`;
    });

    sendDiag(`main-process stats — ${parts.join(" | ")}`);
  }, 5000);
}

function stopStats(): void {
  if (!statsInterval) return;
  clearInterval(statsInterval);
  statsInterval = null;
}

function drain(window: BrowserWindow): void {
  let chunk = mixer.pull();

  while (chunk) {
    if (window.isDestroyed()) return;

    const ab = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    );
    window.webContents.send("native-audio-data", ab);
    chunk = mixer.pull();
  }
}

function spawnCapture(
  window: BrowserWindow,
  id: string,
  mode: "exclude" | "include",
  targetPid: number,
): boolean {
  const binaryPath = getNativeBinaryPath();
  if (!binaryPath) {
    sendDiag("binary not found, cannot start");
    return false;
  }

  sendDiag(`spawning: id=${id} binary=${binaryPath} mode=${mode} targetPID=${targetPid}`);

  const proc = spawn(binaryPath, [mode, targetPid.toString()], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (!proc.pid) {
    sendDiag(`FAILED to spawn child process for ${id} (no PID)`);
    return false;
  }

  sendDiag(`child process for ${id} PID=${proc.pid}`);

  const capture: Capture = { proc, bytes: 0, chunks: 0 };
  captures.set(id, capture);
  mixer.add(id);
  startStats();

  let firstDataLogged = false;

  proc.stdout?.on("data", (chunk: Buffer) => {
    if (window.isDestroyed()) {
      stopNativeAudioCapture();
      return;
    }

    capture.bytes += chunk.byteLength;
    capture.chunks++;

    if (!firstDataLogged) {
      sendDiag(`first PCM data from ${id}: ${chunk.byteLength} bytes`);
      firstDataLogged = true;
    }

    mixer.push(id, chunk);
    drain(window);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    sendDiag(`[${id} stderr] ${data.toString().trimEnd()}`);
  });

  // Both handlers check that the entry is still this process. Deselecting an
  // application and selecting it again inside the half second a stop is given
  // spawns a new capture under the same id, and the old process exiting must
  // not take the new one out of the map with it.
  proc.on("error", (err) => {
    sendDiag(`spawn error for ${id}: ${err.message}`);
    if (captures.get(id) === capture) forget(id);
  });

  proc.on("exit", (code, signal) => {
    sendDiag(
      `${id} exited code=${code} signal=${signal} totalBytes=${capture.bytes} chunks=${capture.chunks}`,
    );

    if (captures.get(id) === capture) forget(id);

    // The renderer's capture is over when nothing is left feeding it. One
    // application of several going away is not that.
    if (captures.size === 0 && !window.isDestroyed()) {
      diagnosticWindow = null;
      window.webContents.send("native-audio-stopped");
    }
  });

  return true;
}

function forget(id: string): void {
  captures.delete(id);
  mixer.remove(id);
  if (captures.size === 0) stopStats();
}

function killCapture(id: string): void {
  const capture = captures.get(id);
  if (!capture) return;

  sendDiag(`stopping ${id}...`);
  forget(id);

  try {
    capture.proc.stdin?.write("\n");
    capture.proc.stdin?.end();
  } catch {
    // Process may have already exited
  }

  setTimeout(() => {
    try {
      capture.proc.kill();
    } catch {
      // Already dead
    }
  }, 500);
}

export function startNativeAudioCapture(
  window: BrowserWindow,
  sourceId?: string,
): boolean {
  stopNativeAudioCapture();

  diagnosticWindow = window;

  let mode: "exclude" | "include";
  let targetPid: number;

  if (sourceId && sourceId.startsWith("window:")) {
    const windowPid = resolveWindowPid(sourceId);
    if (!windowPid) {
      sendDiag(`could not resolve PID for ${sourceId}, falling back to exclude mode`);
      mode = "exclude";
      targetPid = process.pid;
    } else {
      mode = "include";
      targetPid = windowPid;
    }
  } else {
    mode = "exclude";
    targetPid = process.pid;
  }

  sendDiag(`start requested sourceId=${sourceId ?? "none"}`);

  return spawnCapture(window, SYSTEM_AUDIO_SOURCE_ID, mode, targetPid);
}

export interface AudioCaptureSourceState {
  id: string;
}

/**
 * Replace the set of applications being captured.
 *
 * An empty list means the share goes back to everything except Gryt, which is
 * what a screen share starts as. Otherwise the machine-wide capture is
 * dropped: the chosen applications are already in it, and running both would
 * send them twice.
 *
 * Ids are the renderer's to choose and are the desktopCapturer window source
 * ids it already has, so nothing has to be enumerated twice.
 */
export function setAudioCaptureApplications(
  window: BrowserWindow,
  sourceIds: string[],
): AudioCaptureSourceState[] {
  diagnosticWindow = window;

  // Windows that cannot be resolved to a process are dropped here rather than
  // reported as captured, so the UI does not show a tick over something that
  // is not being sent.
  const resolved: { sourceId: string; key: string }[] = [];

  for (const sourceId of sourceIds) {
    const pid = resolveWindowPid(sourceId);
    if (!pid) {
      sendDiag(`could not resolve PID for ${sourceId}, not capturing it`);
      continue;
    }

    resolved.push({ sourceId, key: pidKey(pid) });
  }

  const plan: CapturePlan = planCaptureChange(
    [...captures.keys()],
    resolved.map((r) => r.key),
  );

  for (const key of plan.kill) killCapture(key);

  if (plan.system) {
    requestedSources = [];
    if (!captures.has(SYSTEM_AUDIO_SOURCE_ID)) startNativeAudioCapture(window);
    return listAudioCaptureSources();
  }

  for (const key of plan.spawn) {
    const pid = Number(key.slice(4));
    spawnCapture(window, key, "include", pid);
  }

  // Nothing could be started and the machine-wide capture is already gone.
  // Falling back beats ending the share's audio without saying so.
  if (captures.size === 0) {
    sendDiag("no application capture could be started, falling back to the machine");
    requestedSources = [];
    startNativeAudioCapture(window);
    return listAudioCaptureSources();
  }

  requestedSources = resolved
    .filter((r) => captures.has(r.key))
    .map((r) => r.sourceId);

  return listAudioCaptureSources();
}

export function listAudioCaptureSources(): AudioCaptureSourceState[] {
  if (captures.has(SYSTEM_AUDIO_SOURCE_ID)) {
    return [{ id: SYSTEM_AUDIO_SOURCE_ID }];
  }

  return requestedSources.map((id) => ({ id }));
}

export function stopNativeAudioCapture(): void {
  requestedSources = [];

  if (captures.size === 0) return;

  for (const id of [...captures.keys()]) killCapture(id);

  diagnosticWindow = null;
  stopStats();
}
