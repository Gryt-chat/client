/** gryt-voice (GRYT-1837): the native voice engine from @gryt/voice in its own process, so a call's audio never goes
    through Chromium. The renderer drives it over IPC; it speaks lines on stdin and stdout. macOS only for now. */

import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { app, ipcMain, type WebContents } from "electron";
import { existsSync } from "fs";
import { join } from "path";

import { allowedVoiceCommand, startLine, type VoiceStart } from "./voiceHelperLines";

export function voiceHelperFileName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "gryt-voice.exe" : "gryt-voice";
}

/** Where the build put it: resources/voice when packaged, build/voice/<arch> in a checkout. */
export function voiceHelperPath(o: { platform: NodeJS.Platform; arch: string; isPackaged: boolean; resourcesPath: string; devRoot: string }): string {
  const name = voiceHelperFileName(o.platform);
  return o.isPackaged ? join(o.resourcesPath, "voice", name) : join(o.devRoot, "build", "voice", o.arch, name);
}

export function registerVoiceHelper(binary: string): void {
  let child: ChildProcessWithoutNullStreams | null = null;
  let listener: WebContents | null = null;
  let started: ((ok: boolean) => void) | null = null;

  const ensure = (): ChildProcessWithoutNullStreams | null => {
    if (child) return child;
    if (!existsSync(binary)) return null;
    const proc = spawn(binary, [], { stdio: "pipe", windowsHide: true });
    let rest = "";
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("started ")) {
          started?.(line === "started 1");
          started = null;
        } else if (line.startsWith("r ") && listener && !listener.isDestroyed()) {
          listener.send("voice-helper-report", line);
        }
      }
    });
    proc.on("exit", () => {
      if (child === proc) child = null;
      started?.(false);
      started = null;
      if (listener && !listener.isDestroyed()) listener.send("voice-helper-exit");
    });
    child = proc;
    return proc;
  };

  ipcMain.handle("voice-helper-available", () => existsSync(binary));

  ipcMain.handle("voice-helper-start", (event, s: VoiceStart) => {
    const line = startLine(s);
    const proc = line ? ensure() : null;
    if (!line || !proc) return false;
    listener = event.sender;
    started?.(false);
    return new Promise<boolean>((resolve) => {
      started = resolve;
      proc.stdin.write(line);
    });
  });

  ipcMain.on("voice-helper-send", (_event, line: unknown) => {
    if (allowedVoiceCommand(line)) child?.stdin.write(`${line}\n`);
  });

  // Closing stdin is its quit: it stops the engine and exits on its own.
  app.on("will-quit", () => child?.stdin.end());
}
