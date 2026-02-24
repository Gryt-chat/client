import { contextBridge, ipcRenderer } from "electron";

type Callback = () => void;

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

  installUpdate() {
    ipcRenderer.send("install-update");
  },

  getBetaChannel(): Promise<boolean> {
    return ipcRenderer.invoke("get-beta-channel");
  },

  setBetaChannel(enabled: boolean) {
    ipcRenderer.send("set-beta-channel", enabled);
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

  getDesktopSources(): Promise<Array<{ id: string; name: string; thumbnail: string; appIcon: string; sourceType: "screen" | "window"; width?: number; height?: number }>> {
    return ipcRenderer.invoke("get-desktop-sources");
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
});
