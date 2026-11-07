// Renders motion.html to an MP4 one frame at a time: node scripts/render-motion.mjs [out.mp4] [maxSeconds]
// Needs the dev server (`vite --port 3777`), Playwright's Chromium and ffmpeg.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { writeTrack } from "./motion-sfx.mjs";

const out = process.argv[2] ?? "motion.mp4";
const maxSeconds = Number(process.argv[3] ?? 120);
const url = process.env.MOTION_URL ?? `http://localhost:3778/motion.html?render${process.env.MOTION_DBG ? "&dbg" : ""}`;
const FPS = Number(process.env.MOTION_FPS ?? 60);
const draft = !!process.env.MOTION_DRAFT;
// The page is laid out at 1280x720 and drawn at a higher pixel ratio: the app's dialogs and menus then read at
// the size somebody sees them on a laptop, and text stays sharp. OUT_W picks 1920 (1080p) or 2560 (1440p).
const OUT_W = Number(process.env.MOTION_OUT_W ?? 1920);
const CSS_W = 1280, CSS_H = 720, DPR = OUT_W / CSS_W;

// Third-party art stays out of the repository; it is fetched here when missing.
const assets = new URL("../public/motion-assets/", import.meta.url).pathname;
if (!existsSync(join(assets, "emoji"))) {
  mkdirSync(join(assets, "emoji"), { recursive: true });
  for (const { name } of await (await fetch("https://community.gryt.chat/api/emojis")).json()) {
    const res = await fetch(`https://community.gryt.chat/api/emojis/img/${encodeURIComponent(name)}`);
    writeFileSync(join(assets, "emoji", `${name}.webp`), Buffer.from(await res.arrayBuffer()));
  }
}
if (!existsSync(join(assets, "wiggle.webp"))) {
  mkdirSync(assets, { recursive: true });
  const res = await fetch("https://community.gryt.chat/api/emojis/img/kitty_wiggle");
  writeFileSync(join(assets, "wiggle.webp"), Buffer.from(await res.arrayBuffer()));
}

const cache = join(homedir(), "Library/Caches/ms-playwright");
const build = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
const chromePath = join(cache, build, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const profile = mkdtempSync(join(tmpdir(), "gryt-motion-"));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });

try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await new Promise((r) => setTimeout(r, 200));
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => null);
  }
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") console.error("page: Uncaught", m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.error("page:", m.params.args.map((a) => a.value ?? a.description).join(" "));
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: CSS_W, height: CSS_H, deviceScaleFactor: DPR, mobile: false });
  await cdp("Page.enable");
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp("Page.navigate", { url });
  for (let i = 0; i < 100 && !(await evaluate("typeof window.__advance === 'function' && !!document.getElementById('stage')")); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 1500));

  // Two captures per output frame, averaged: object motion blur at a 180° shutter.
  const SUB = draft ? 1 : 2;
  const silent = out.replace(/\.mp4$/, ".silent.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-i", "-", "-vf", `tmix=frames=${SUB},framestep=${SUB}`, "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-pix_fmt", "yuv420p", silent], { stdio: ["pipe", "inherit", "inherit"] });
  let frame = 0;
  for (; frame < maxSeconds * FPS * SUB; frame++) {
    await evaluate(`window.__advance(${1000 / (FPS * SUB)})`);
    const shot = await cdp("Page.captureScreenshot", { format: draft ? "jpeg" : "png", quality: draft ? 90 : undefined, clip: { x: 0, y: 0, width: CSS_W, height: CSS_H, scale: 1 } });
    ff.stdin.write(Buffer.from(shot.result.data, "base64"));
    if (frame % 60 === 0 && (await evaluate("!!window.__done"))) break;
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  frame = frame / SUB;
  const wav = out.replace(/\.mp4$/, ".wav");
  writeTrack((await evaluate("window.__sfx ?? []")) ?? [], frame / FPS, wav);
  await new Promise((r) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" }).on("close", r));
  rmSync(silent, { force: true });
  console.log(`${out}: ${(frame / FPS).toFixed(1)} s`);
  ws.close();
} finally {
  chrome.kill("SIGKILL");
  await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.on("exit", r)));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
