const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { app, BrowserWindow } = require("electron");
const { attachDesktopVideoDecoder } = require(process.env.GRYT_DECODER_TEST_MODULE);

app.setPath("userData", process.env.GRYT_DECODER_TEST_PROFILE);
app.on("window-all-closed", () => undefined);
const worker = new EventEmitter();
worker.connected = true;
const pending = new Map();
worker.send = (message, callback) => {
  pending.get(message.id)?.(message);
  pending.delete(message.id);
  callback();
};
const probes = [];
app.on("browser-window-created", (_event, window) => {
  const preferences = window.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.preload, undefined);
  window.webContents.once("did-finish-load", () => {
    probes.push(window.webContents.executeJavaScript(`(async () => ({
      node: typeof require, process: typeof process,
      file: await fetch('file:///etc/passwd').then(() => true, () => false),
      network: await fetch('https://example.com').then(() => true, () => false)
    }))()`));
  });
});
const request = (input) => new Promise((resolve) => {
  const id = require("node:crypto").randomUUID();
  pending.set(id, resolve);
  worker.emit("message", { type: "gryt:video-frame", id, input });
});
const deadline = setTimeout(() => { console.error("Decoder test timed out"); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  attachDesktopVideoDecoder(worker);
  for (const name of ["clip.mp4", "clip.webm"]) {
    const video = readFileSync(join(process.env.GRYT_DECODER_TEST_FIXTURES, name));
    const result = await request(video.toString("base64"));
    assert.equal(result.error, undefined, `${name}: ${result.error}`);
    assert.ok(Buffer.from(result.frame, "base64").subarray(0, 3).equals(Buffer.from([255, 216, 255])));
  }
  const bad = await request(Buffer.from("not a video").toString("base64"));
  assert.match(bad.error, /could not be decoded/);
  for (const probe of await Promise.all(probes)) assert.deepEqual(probe, { node: "undefined", process: "undefined", file: false, network: false });
  worker.emit("exit", 0);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  console.log("desktop video decoder: real MP4, malformed input, sandbox, denied filesystem/network, cleanup passed");
  clearTimeout(deadline);
  app.exit(0);
}).catch((error) => { console.error(error); app.exit(1); });
