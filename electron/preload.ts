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

  onUpdateStatus(callback: (status: { status: string; version?: string; percent?: number; message?: string }) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: { status: string; version?: string; percent?: number; message?: string }) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },

  setBadgeCount(count: number) {
    ipcRenderer.send("set-badge-count", count);
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
