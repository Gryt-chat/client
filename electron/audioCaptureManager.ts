/**
 * Manages a native subprocess that captures system audio while excluding
 * Gryt's own process tree.  PCM data is forwarded to the renderer via IPC.
 *
 * Windows:  WASAPI PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
 * macOS:    ScreenCaptureKit excludesCurrentProcessAudio
 */

import { ChildProcess, spawn } from "child_process";
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

  // In production, extraResources are next to the app executable
  const resourcePath = app.isPackaged
    ? join(process.resourcesPath, "native", binaryName)
    : join(app.getAppPath(), "build", "native", binaryName);

  return existsSync(resourcePath) ? resourcePath : null;
}

export function isNativeAudioCaptureAvailable(): boolean {
  const path = getNativeBinaryPath();
  console.log(`[NativeAudioCapture] available check: binary=${path ?? "NOT FOUND"}`);
  return path !== null;
}

export function startNativeAudioCapture(window: BrowserWindow): boolean {
  if (captureProcess) {
    stopNativeAudioCapture();
  }

  const binaryPath = getNativeBinaryPath();
  if (!binaryPath) {
    console.warn("[NativeAudioCapture] binary not found, cannot start");
    return false;
  }

  const pid = process.pid.toString();
  console.log(
    `[NativeAudioCapture] spawning: binary=${binaryPath} excludePID=${pid} (main process)`,
  );

  captureProcess = spawn(binaryPath, [pid], {
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
    // Send a byte on stdin to signal graceful shutdown
    captureProcess.stdin?.write("\n");
    captureProcess.stdin?.end();
  } catch {
    // Process may have already exited
  }

  // Force kill after a short grace period
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
