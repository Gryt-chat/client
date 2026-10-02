import type { ChildProcess } from "node:child_process";

import { BrowserWindow, session } from "electron";

const MAX_INPUT_LENGTH = Math.ceil(64 * 1024 * 1024 / 3) * 4;

export function attachDesktopVideoDecoder(worker: ChildProcess): void {
  const windows = new Set<BrowserWindow>();
  const decode = async (message: unknown) => {
    if (!message || typeof message !== "object") return;
    const request = message as { type?: unknown; id?: unknown; input?: unknown };
    if (request.type !== "gryt:video-frame" || typeof request.id !== "string" || !/^[a-f0-9-]{36}$/.test(request.id)) return;
    const reply = (result: { frame?: string; error?: string }) => {
      if (worker.connected) worker.send({ type: "gryt:video-frame-result", id: request.id, ...result }, () => undefined);
    };
    if (windows.size >= 2 || typeof request.input !== "string" || request.input.length > MAX_INPUT_LENGTH
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(request.input)) {
      reply({ error: "Video exceeds desktop decoder limits" });
      return;
    }
    const isolated = session.fromPartition("gryt-video-decoder", { cache: false });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    isolated.setPermissionCheckHandler(() => false);
    isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(data:|blob:)/.test(details.url) }));
    isolated.on("will-download", (event) => event.preventDefault());
    const window = new BrowserWindow({ show: false, webPreferences: {
      session: isolated, sandbox: true, nodeIntegration: false, contextIsolation: true,
      webSecurity: true, backgroundThrottling: false,
    } });
    windows.add(window);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    const timeout = setTimeout(() => { if (!window.isDestroyed()) window.destroy(); }, 12000);
    try {
      await window.loadURL("data:text/html,<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; media-src blob:; script-src 'unsafe-eval'\">");
      const frame: unknown = await window.webContents.executeJavaScript(`(async () => {
        const bytes = Uint8Array.from(atob(${JSON.stringify(request.input)}), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        try {
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = () => reject(new Error('Video could not be decoded'));
            video.src = url;
          });
          if (!video.videoWidth || !video.videoHeight || video.videoWidth * video.videoHeight > 100000000) throw new Error('Video exceeds pixel limit');
          const seek = Math.min(1, Number.isFinite(video.duration) ? video.duration / 2 : 0);
          if (seek > 0) await new Promise((resolve, reject) => {
            video.onseeked = resolve;
            video.onerror = () => reject(new Error('Video frame could not be decoded'));
            video.currentTime = seek;
          });
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(320, video.videoWidth);
          canvas.height = Math.max(1, Math.round(video.videoHeight * canvas.width / video.videoWidth));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        } finally {
          video.removeAttribute('src');
          video.load();
          URL.revokeObjectURL(url);
        }
      })()`);
      if (typeof frame !== "string" || frame.length > 4 * 1024 * 1024) throw new Error("Invalid video frame");
      reply({ frame });
    } catch {
      reply({ error: "Video could not be decoded in the desktop sandbox" });
    } finally {
      clearTimeout(timeout);
      windows.delete(window);
      if (!window.isDestroyed()) window.destroy();
      await isolated.clearStorageData().catch(() => undefined);
    }
  };
  worker.on("message", (message) => { void decode(message); });
  worker.once("exit", () => {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    windows.clear();
  });
}
