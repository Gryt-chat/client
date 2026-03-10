/**
 * Manages a native subprocess that captures the screen via DXGI Desktop
 * Duplication.
 *
 * Two modes of operation:
 *
 *   **WebSocket mode** (preferred)  — the binary runs a local WS server and
 *   the renderer connects directly. Frame data never touches the main
 *   process. The main process only manages the child lifetime and relays
 *   the port number.
 *
 *   **Legacy stdout mode** — the binary writes raw I420 frames to stdout
 *   and the main process parses + forwards them via IPC. This is the
 *   fallback when the binary is too old to support `--ws`.
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

export interface CaptureStartResult {
  success: boolean;
  wsPort?: number;
}

export async function startNativeScreenCapture(
  window: BrowserWindow,
  monitorIndex: number,
  fps: number,
  maxWidth?: number,
  maxHeight?: number,
  bitrate?: number,
  codec?: string,
): Promise<CaptureStartResult> {
  if (captureProcess) {
    stopNativeScreenCapture();
  }

  targetWindow = window;
  const binaryPath = getBinaryPath();
  if (!binaryPath) {
    log("binary not found");
    return { success: false };
  }

  const args = [monitorIndex.toString(), fps.toString()];
  if (maxWidth && maxHeight) {
    args.push(maxWidth.toString(), maxHeight.toString());
  }
  args.push("--ws");
  if (bitrate && bitrate > 0) {
    args.push("--bitrate", bitrate.toString());
  }
  if (codec) {
    args.push("--codec", codec);
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
    return { success: false };
  }

  let wsPort: number | undefined;
  let portResolved = false;

  // Parse stderr for the WebSocket port and diagnostics
  captureProcess.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trimEnd();
    log(`[stderr] ${text}`);

    if (!portResolved) {
      const match = text.match(/\[ws\] port=(\d+)/);
      if (match) {
        wsPort = parseInt(match[1], 10);
        portResolved = true;
      }
    }
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

  // Wait (up to 3s) for the port to appear in stderr.
  // The binary prints it almost immediately after spawning.
  const deadline = Date.now() + 3000;
  return new Promise<CaptureStartResult>((resolve) => {
    const check = () => {
      if (portResolved && wsPort) {
        log(`WebSocket mode ready on port ${wsPort}`);
        resolve({ success: true, wsPort });
      } else if (Date.now() > deadline || !captureProcess) {
        log("timeout waiting for WebSocket port, falling back to stdout mode");
        setupStdoutRelay();
        resolve({ success: true });
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

/**
 * Legacy fallback: parse frames from stdout and forward via IPC.
 * Used when the binary doesn't support --ws.
 */
function setupStdoutRelay(): void {
  if (!captureProcess?.stdout || !targetWindow) return;

  let pendingBuf = Buffer.alloc(0);
  let expectedFrameSize = 0;
  let frameWidth = 0;
  let frameHeight = 0;
  let frameTimestamp = BigInt(0);
  const HEADER_SIZE = 4 + 4 + 8;

  captureProcess.stdout.on("data", (chunk: Buffer) => {
    if (!targetWindow || targetWindow.isDestroyed()) {
      stopNativeScreenCapture();
      return;
    }

    pendingBuf = Buffer.concat([pendingBuf, chunk]);

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
    }
  });
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
