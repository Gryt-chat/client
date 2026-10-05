/* The desktop stand-in for the image worker's jail (GRYT-1664). A hidden, sandboxed Chromium
   renderer decodes and writes out uploads for a server hosted from the app. */
import { BrowserWindow, ipcMain, session, type WebContents } from "electron";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

import { MAX_MEDIA_BYTES, type MediaJob, type MediaResult } from "./mediaSandboxFormat";

const JOB_TIMEOUT_MS = 120_000;
// Closed when idle, so it holds no memory between uploads and never keeps the app from quitting.
const IDLE_CLOSE_MS = 30_000;
const PARTITION = "gryt-media-sandbox";
const here = dirname(fileURLToPath(import.meta.url));
const pagePath = join(here, "mediaSandbox.html");

let win: BrowserWindow | null = null;
let ready: Promise<WebContents> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (r: MediaResult) => void; timer: NodeJS.Timeout }>();
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;
let idleTimer: NodeJS.Timeout | null = null;

function failAll(reason: string): void {
  for (const [id, job] of pending) {
    clearTimeout(job.timer);
    job.resolve({ ok: false, reason });
    pending.delete(id);
  }
}

function discard(reason: string): void {
  const old = win;
  win = null;
  ready = null;
  failAll(reason);
  if (old && !old.isDestroyed()) old.destroy();
}

/* Its own in-memory session: nothing it does is stored, and any request other than its own
   page and the blob: URLs it makes is cancelled, so a hostile file cannot reach the network. */
function lockSession(): Electron.Session {
  const ses = session.fromPartition(PARTITION, { cache: false });
  const page = pathToFileURL(pagePath).href;
  const script = pathToFileURL(join(here, "mediaSandboxPage.js")).href;
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === page || details.url === script || details.url.startsWith("blob:");
    callback({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.on("will-download", (event) => event.preventDefault());
  return ses;
}

function open(): Promise<WebContents> {
  if (ready) return ready;
  const w = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
      session: lockSession(),
      preload: join(here, "mediaSandboxPreload.cjs"),
    },
  });
  win = w;
  const wc = w.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (event) => event.preventDefault());
  wc.on("render-process-gone", (_event, details) => {
    if (win === w) discard(`The media sandbox stopped (${details.reason})`);
  });
  wc.on("unresponsive", () => {
    if (win === w) discard("The media sandbox stopped responding");
  });
  ready = w.loadFile(pagePath).then(() => wc);
  ready.catch(() => {
    if (win === w) discard("The media sandbox could not load");
  });
  return ready;
}

ipcMain.on("media-sandbox:done", (event, id: unknown, result: unknown) => {
  if (!win || event.sender !== win.webContents || typeof id !== "number") return;
  const job = pending.get(id);
  if (!job) return;
  clearTimeout(job.timer);
  pending.delete(id);
  job.resolve(result as MediaResult);
});

async function runOne(job: MediaJob): Promise<MediaResult> {
  if (job.bytes.length === 0 || job.bytes.length > MAX_MEDIA_BYTES) {
    return { ok: false, reason: "File is empty or too large to process" };
  }
  let wc: WebContents;
  try {
    wc = await open();
  } catch {
    return { ok: false, reason: "The media sandbox could not load" };
  }
  const id = nextId++;
  return new Promise<MediaResult>((resolve) => {
    // A job that runs out of time takes the renderer with it, since it may still be decoding.
    const timer = setTimeout(() => discard("The media sandbox ran out of time"), JOB_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
    wc.send("media-sandbox:job", id, job);
  });
}

/** One job at a time: a single renderer, and a decode bomb only ever has itself to blame. */
export function runMediaJob(job: MediaJob): Promise<MediaResult> {
  queued++;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const result = queue.then(() => runOne(job));
  queue = result
    .catch(() => undefined)
    .finally(() => {
      if (--queued > 0) return;
      idleTimer = setTimeout(() => discard("The media sandbox was idle"), IDLE_CLOSE_MS);
    });
  return result;
}

export function closeMediaSandbox(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  discard("The app is closing");
}
