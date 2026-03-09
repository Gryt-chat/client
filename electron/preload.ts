import { contextBridge, ipcRenderer } from "electron";

type Callback = () => void;

// Buffer invite deep links that arrive before React mounts a listener
// (happens when the app is cold-launched via gryt://invite?...).
let bufferedInvite: { host: string; code: string } | null = null;
ipcRenderer.on("deep-link-invite", (_event, data: { host: string; code: string }) => {
  bufferedInvite = data;
});

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,

  getAppVersion(): Promise<string> {
    return ipcRenderer.invoke("get-app-version");
  },

  onPttDown(callback: Callback) {
    ipcRenderer.on("ptt-down", callback);
    return () => ipcRenderer.removeListener("ptt-down", callback);
  },

  onPttUp(callback: Callback) {
    ipcRenderer.on("ptt-up", callback);
    return () => ipcRenderer.removeListener("ptt-up", callback);
  },

  setPttKey(pttKey: string) {
    ipcRenderer.send("ptt-set-key", pttKey);
  },

  checkForUpdates() {
    ipcRenderer.send("check-for-updates");
  },

  downloadUpdate() {
    ipcRenderer.send("download-update");
  },

  installUpdate() {
    ipcRenderer.send("install-update");
  },

  getBetaChannel(): Promise<boolean> {
    return ipcRenderer.invoke("get-beta-channel");
  },

  setBetaChannel(enabled: boolean) {
    ipcRenderer.send("set-beta-channel", enabled);
  },

  switchUpdateChannel(enabled: boolean) {
    ipcRenderer.send("switch-update-channel", enabled);
  },

  getCloseToTray(): Promise<boolean> {
    return ipcRenderer.invoke("get-close-to-tray");
  },

  setCloseToTray(enabled: boolean) {
    ipcRenderer.send("set-close-to-tray", enabled);
  },

  setSignedIn(signedIn: boolean) {
    ipcRenderer.send("set-signed-in", signedIn);
  },

  getStartWithWindowsSupported(): Promise<boolean> {
    return ipcRenderer.invoke("get-start-with-windows-supported");
  },

  getStartWithWindows(): Promise<boolean> {
    return ipcRenderer.invoke("get-start-with-windows");
  },

  setStartWithWindows(enabled: boolean) {
    ipcRenderer.send("set-start-with-windows", enabled);
  },

  getStartMinimizedOnLogin(): Promise<boolean> {
    return ipcRenderer.invoke("get-start-minimized-on-login");
  },

  setStartMinimizedOnLogin(enabled: boolean) {
    ipcRenderer.send("set-start-minimized-on-login", enabled);
  },

  getHardwareAcceleration(): Promise<boolean> {
    return ipcRenderer.invoke("get-hardware-acceleration");
  },

  setHardwareAcceleration(enabled: boolean) {
    ipcRenderer.send("set-hardware-acceleration", enabled);
  },

  onUpdateStatus(callback: (status: { status: string; version?: string; percent?: number; message?: string }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; version?: string; percent?: number; message?: string }) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },

  setBadgeCount(count: number) {
    ipcRenderer.send("set-badge-count", count);
  },

  toggleAlwaysOnTop(pinned: boolean, windowTitle?: string) {
    ipcRenderer.send("toggle-always-on-top", pinned, windowTitle);
  },

  getScreenCaptureAccess(): Promise<string> {
    return ipcRenderer.invoke("get-screen-capture-access");
  },

  getDesktopSources(): Promise<Array<{ id: string; name: string; thumbnail: string; appIcon: string; sourceType: "screen" | "window"; width?: number; height?: number }>> {
    return ipcRenderer.invoke("get-desktop-sources");
  },

  isNativeAudioCaptureAvailable(): Promise<boolean> {
    return ipcRenderer.invoke("native-audio-capture-available");
  },

  startNativeAudioCapture(sourceId?: string): Promise<boolean> {
    return ipcRenderer.invoke("start-native-audio-capture", sourceId);
  },

  stopNativeAudioCapture() {
    ipcRenderer.send("stop-native-audio-capture");
  },

  onNativeAudioData(callback: (pcm: ArrayBuffer) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: ArrayBuffer) => callback(data);
    ipcRenderer.on("native-audio-data", handler);
    return () => ipcRenderer.removeListener("native-audio-data", handler);
  },

  onNativeAudioStopped(callback: () => void) {
    const handler = () => callback();
    ipcRenderer.on("native-audio-stopped", handler);
    return () => ipcRenderer.removeListener("native-audio-stopped", handler);
  },

  onNativeAudioDiagnostic(callback: (msg: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on("native-audio-diagnostic", handler);
    return () => ipcRenderer.removeListener("native-audio-diagnostic", handler);
  },

  isNativeScreenCaptureAvailable(): Promise<boolean> {
    return ipcRenderer.invoke("native-screen-capture:available");
  },

  startNativeScreenCapture(monitorIndex: number, fps: number, maxWidth?: number, maxHeight?: number): Promise<boolean> {
    return ipcRenderer.invoke("native-screen-capture:start", monitorIndex, fps, maxWidth, maxHeight);
  },

  stopNativeScreenCapture() {
    ipcRenderer.send("native-screen-capture:stop");
  },

  onNativeScreenFrame(callback: (frame: { width: number; height: number; timestampUs: number; data: ArrayBuffer }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, frame: { width: number; height: number; timestampUs: number; data: ArrayBuffer }) => callback(frame);
    ipcRenderer.on("native-screen-capture:frame", handler);
    return () => ipcRenderer.removeListener("native-screen-capture:frame", handler);
  },

  onNativeScreenCaptureStopped(callback: () => void) {
    const handler = () => callback();
    ipcRenderer.on("native-screen-capture:stopped", handler);
    return () => ipcRenderer.removeListener("native-screen-capture:stopped", handler);
  },

  onWindowFocusChange(callback: (focused: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, focused: boolean) => callback(focused);
    ipcRenderer.on("window-focus-change", handler);
    return () => ipcRenderer.removeListener("window-focus-change", handler);
  },

  openExternal(url: string) {
    ipcRenderer.send("auth:open-external", url);
  },

  onAuthCallback(callback: (url: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, url: string) =>
      callback(url);
    ipcRenderer.on("auth-callback", handler);
    return () => ipcRenderer.removeListener("auth-callback", handler);
  },

  loadUserData(userId: string): Promise<Record<string, unknown>> {
    return ipcRenderer.invoke("user-store:load", userId);
  },

  saveUserData(userId: string, data: Record<string, unknown>) {
    ipcRenderer.send("user-store:save", userId, data);
  },

  setUserData(userId: string, key: string, value: unknown) {
    ipcRenderer.send("user-store:set", userId, key, value);
  },

  // ── Global file store (backs localStorage) ─────────────────────
  loadGlobalStore(): Promise<Record<string, unknown>> {
    return ipcRenderer.invoke("global-store:load");
  },

  setGlobalData(key: string, value: unknown) {
    ipcRenderer.send("global-store:set", key, value);
  },

  deleteGlobalData(key: string) {
    ipcRenderer.send("global-store:delete", key);
  },

  saveGlobalStore(data: Record<string, unknown>) {
    ipcRenderer.send("global-store:save", data);
  },

  // ── Addons ────────────────────────────────────────────────────
  listAddons(): Promise<Array<{ id: string; name: string; version: string; type: "plugin" | "theme"; description?: string; author?: string; banner?: string; styles?: string[]; main?: string }>> {
    return ipcRenderer.invoke("addons:list");
  },

  openAddonsFolder(): Promise<string> {
    return ipcRenderer.invoke("addons:open-folder");
  },

  onAddonsChanged(callback: (addons: Array<{ id: string; name: string; version: string; type: "plugin" | "theme"; description?: string; author?: string; banner?: string; styles?: string[]; main?: string }>) => void) {
    const handler = (_event: Electron.IpcRendererEvent, addons: Array<{ id: string; name: string; version: string; type: "plugin" | "theme"; description?: string; author?: string; banner?: string; styles?: string[]; main?: string }>) => callback(addons);
    ipcRenderer.on("addons-changed", handler);
    return () => ipcRenderer.removeListener("addons-changed", handler);
  },

  onLanServerDiscovered(callback: (server: { name: string; host: string; port: number; version: string | null }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: { name: string; host: string; port: number; version: string | null }) =>
      callback(data);
    ipcRenderer.on("lan-server-discovered", handler);
    return () => ipcRenderer.removeListener("lan-server-discovered", handler);
  },

  onLanServerRemoved(callback: (server: { host: string; port: number }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: { host: string; port: number }) =>
      callback(data);
    ipcRenderer.on("lan-server-removed", handler);
    return () => ipcRenderer.removeListener("lan-server-removed", handler);
  },

  onDeepLinkInvite(callback: (data: { host: string; code: string }) => void) {
    if (bufferedInvite) {
      const data = bufferedInvite;
      bufferedInvite = null;
      queueMicrotask(() => callback(data));
    }
    const handler = (_event: Electron.IpcRendererEvent, data: { host: string; code: string }) => {
      bufferedInvite = null;
      callback(data);
    };
    ipcRenderer.on("deep-link-invite", handler);
    return () => ipcRenderer.removeListener("deep-link-invite", handler);
  },
});
