/**
 * Manages a native subprocess that captures the screen via DXGI Desktop
 * Duplication and forwards raw I420 frames to the renderer via IPC.
 *
 * Frame protocol (binary, little-endian):
 *   uint32  width
 *   uint32  height
 *   int64   timestamp_us
 *   uint8[] I420 data (width * height * 3/2 bytes)
 *
 * Windows only. Requires screen-capture.exe in build/native/.
 */

import { ChildProcess, spawn } from "child_process";
import { app, BrowserWindow } from "electron";
import { existsSync } from "fs";
import { join } from "path";

let captureProcess: ChildProcess | null = null;
let targetWindow: BrowserWindow | null = null;

function log(msg: string): void {
  console.log("[NativeScreenCapture]", msg);
}

function getBinaryPath(): string | null {
  if (process.platform !== "win32") return null;

  const binaryName = "screen-capture.exe";
  const resourcePath = app.isPackaged
    ? join(process.resourcesPath, "native", binaryName)
    : join(app.getAppPath(), "build", "native", binaryName);

  return existsSync(resourcePath) ? resourcePath : null;
}

export function isNativeScreenCaptureAvailable(): boolean {
  return getBinaryPath() !== null;
}

export function startNativeScreenCapture(
  window: BrowserWindow,
  monitorIndex: number,
  fps: number,
  maxWidth?: number,
  maxHeight?: number,
): boolean {
  if (captureProcess) {
    stopNativeScreenCapture();
  }

  targetWindow = window;
  const binaryPath = getBinaryPath();
  if (!binaryPath) {
    log("binary not found");
    return false;
  }

  const args = [monitorIndex.toString(), fps.toString()];
  if (maxWidth && maxHeight) {
    args.push(maxWidth.toString(), maxHeight.toString());
  }

  log(`spawning: ${binaryPath} ${args.join(" ")}`);

  captureProcess = spawn(binaryPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const pid = captureProcess.pid;
  log(`child PID=${pid}`);

  if (!pid) {
    log("FAILED to spawn (no PID)");
    captureProcess = null;
    return false;
  }

  let pendingBuf = Buffer.alloc(0);
  let expectedFrameSize = 0;
  let frameWidth = 0;
  let frameHeight = 0;
  let frameTimestamp = BigInt(0);
  const HEADER_SIZE = 4 + 4 + 8; // width(4) + height(4) + timestamp(8)

  let framesDelivered = 0;
  let lastStatsTick = Date.now();

  captureProcess.stdout?.on("data", (chunk: Buffer) => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      stopNativeScreenCapture();
      return;
    }

    pendingBuf = Buffer.concat([pendingBuf, chunk]);

    // Process all complete frames in the buffer
    for (;;) {
      if (expectedFrameSize === 0) {
        if (pendingBuf.length < HEADER_SIZE) break;

        frameWidth = pendingBuf.readUInt32LE(0);
        frameHeight = pendingBuf.readUInt32LE(4);
        frameTimestamp = pendingBuf.readBigInt64LE(8);
        expectedFrameSize = (frameWidth * frameHeight * 3) / 2;
        pendingBuf = pendingBuf.subarray(HEADER_SIZE);
      }

      if (pendingBuf.length < expectedFrameSize) break;

      const frameData = pendingBuf.subarray(0, expectedFrameSize);
      pendingBuf = pendingBuf.subarray(expectedFrameSize);
      expectedFrameSize = 0;

      const ab = frameData.buffer.slice(
        frameData.byteOffset,
        frameData.byteOffset + frameData.byteLength,
      );

      targetWindow.webContents.send("native-screen-capture:frame", {
        width: frameWidth,
        height: frameHeight,
        timestampUs: Number(frameTimestamp),
        data: ab,
      });

      framesDelivered++;
    }

    const now = Date.now();
    if (now - lastStatsTick >= 5000) {
      const elapsed = (now - lastStatsTick) / 1000;
      log(`${framesDelivered} frames in ${elapsed.toFixed(1)}s (${(framesDelivered / elapsed).toFixed(1)} fps)`);
      framesDelivered = 0;
      lastStatsTick = now;
    }
  });

  captureProcess.stderr?.on("data", (data: Buffer) => {
    log(`[stderr] ${data.toString().trimEnd()}`);
  });

  captureProcess.on("error", (err) => {
    log(`spawn error: ${err.message}`);
    captureProcess = null;
  });

  captureProcess.on("exit", (code, signal) => {
    log(`exited code=${code} signal=${signal}`);
    captureProcess = null;
    if (targetWindow && !targetWindow.isDestroyed()) {
      targetWindow.webContents.send("native-screen-capture:stopped");
    }
    targetWindow = null;
  });

  return true;
}

export function stopNativeScreenCapture(): void {
  if (!captureProcess) return;

  log("stopping capture...");

  try {
    captureProcess.stdin?.write("\n");
    captureProcess.stdin?.end();
  } catch {
    // Already exited
  }

  const proc = captureProcess;
  captureProcess = null;
  targetWindow = null;
  setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // Already dead
    }
  }, 500);
}
