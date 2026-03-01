/**
 * Manages a native subprocess that captures system audio via WASAPI process
 * loopback and forwards raw PCM to the renderer via IPC.
 *
 * Two capture modes:
 *   "exclude" — capture ALL system audio except Gryt's process tree
 *   "include" — capture ONLY a specific application's process tree audio
 *
 * Windows:  WASAPI PROCESS_LOOPBACK_MODE_{INCLUDE,EXCLUDE}_TARGET_PROCESS_TREE
 * macOS:    ScreenCaptureKit excludesCurrentProcessAudio
 */

import { ChildProcess, execFileSync, spawn } from "child_process";
import { app, BrowserWindow } from "electron";
import { existsSync } from "fs";
import { join } from "path";

let captureProcess: ChildProcess | null = null;

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

export function startNativeAudioCapture(
  window: BrowserWindow,
  sourceId?: string,
): boolean {
  if (captureProcess) {
    stopNativeAudioCapture();
  }

  const binaryPath = getNativeBinaryPath();
  if (!binaryPath) {
    console.warn("[NativeAudioCapture] binary not found, cannot start");
    return false;
  }

  let mode: "exclude" | "include";
  let targetPid: number;

  if (sourceId && sourceId.startsWith("window:")) {
    const windowPid = resolveWindowPid(sourceId);
    if (!windowPid) {
      console.warn(`[NativeAudioCapture] could not resolve PID for ${sourceId}, falling back to exclude mode`);
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

  console.log(
    `[NativeAudioCapture] spawning: binary=${binaryPath} mode=${mode} targetPID=${targetPid} sourceId=${sourceId ?? "none"}`,
  );

  captureProcess = spawn(binaryPath, [mode, targetPid.toString()], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const childPid = captureProcess.pid;
  console.log(`[NativeAudioCapture] child process PID=${childPid}`);

  let bytesReceived = 0;
  let firstDataLogged = false;

  captureProcess.stdout?.on("data", (chunk: Buffer) => {
    if (window.isDestroyed()) {
      stopNativeAudioCapture();
      return;
    }
    bytesReceived += chunk.byteLength;
    if (!firstDataLogged) {
      console.log(
        `[NativeAudioCapture] first PCM data received: ${chunk.byteLength} bytes`,
      );
      firstDataLogged = true;
    }
    const ab = chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength,
    );
    window.webContents.send("native-audio-data", ab);
  });

  captureProcess.stderr?.on("data", (data: Buffer) => {
    console.error("[NativeAudioCapture]", data.toString().trimEnd());
  });

  captureProcess.on("exit", (code) => {
    console.log(
      `[NativeAudioCapture] exited code=${code} totalBytes=${bytesReceived}`,
    );
    captureProcess = null;
    if (!window.isDestroyed()) {
      window.webContents.send("native-audio-stopped");
    }
  });

  return true;
}

export function stopNativeAudioCapture(): void {
  if (!captureProcess) return;

  try {
    captureProcess.stdin?.write("\n");
    captureProcess.stdin?.end();
  } catch {
    // Process may have already exited
  }

  const proc = captureProcess;
  captureProcess = null;
  setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // Already dead
    }
  }, 500);
}
