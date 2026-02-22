import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("splashAPI", {
  onUpdateStatus(
    callback: (data: {
      status: string;
      version?: string;
      percent?: number;
      message?: string;
    }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { status: string; version?: string; percent?: number; message?: string }
    ) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },

  getAppVersion(): Promise<string> {
    return ipcRenderer.invoke("get-app-version");
  },
});
