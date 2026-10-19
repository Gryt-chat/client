/* The media sandbox page's only way out: take a job, hand back a result. Nothing else from
   Electron reaches the page. */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("grytMedia", {
  onJob(handler: (id: number, job: unknown) => void) {
    ipcRenderer.on("media-sandbox:job", (_event, id: number, job: unknown) => handler(id, job));
  },
  done(id: number, result: unknown) {
    ipcRenderer.send("media-sandbox:done", id, result);
  },
});
