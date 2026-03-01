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

  toggleAlwaysOnTop(pinned: boolean) {
    ipcRenderer.send("toggle-always-on-top", pinned);
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
