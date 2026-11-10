// Renders motion.html to an MP4 one frame at a time: node scripts/render-motion.ts [out.mp4] [maxSeconds]
// Needs the dev server (`vite --port 3777`), Playwright's Chromium and ffmpeg.

/* eslint-disable @typescript-eslint/ban-types -- DevTools protocol replies are outside input, read field by field. */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { type SfxEvent, writeTrack } from "./motion-sfx.ts";

/** The parts of the DevTools protocol this script reads. */
type Target = { type: string; webSocketDebuggerUrl: string };
type CdpReply = { id?: number; method?: string; params?: { type?: string; args?: { value?: unknown; description?: string }[]; exceptionDetails?: { text: string; exception?: { description?: string } } }; result?: { data?: string; result?: { value?: unknown } } };

const out = process.argv[2] ?? "motion.mp4";
const maxSeconds = Number(process.argv[3] ?? 120);
const url = process.env.MOTION_URL ?? `http://localhost:3778/motion.html?render${process.env.MOTION_DBG ? "&dbg" : ""}`;
const FPS = Number(process.env.MOTION_FPS ?? 60);
const draft = !!process.env.MOTION_DRAFT;
// A slice for render-motion-parallel.ts: frames before FROM are stepped through without screenshots.
const FROM = Number(process.env.MOTION_FROM ?? 0);
const FF_EVERY = Number(process.env.MOTION_FF_EVERY ?? 8);
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
if (!build) throw new Error(`no Playwright Chromium under ${cache}`);
const chromePath = join(cache, build, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const profile = mkdtempSync(join(tmpdir(), "gryt-motion-"));
const port = Number(process.env.MOTION_PORT ?? 9400 + Math.floor(Math.random() * 400));
// Without the compositor flag, 1440p shots caught the call tiles half drawn and they flashed.
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--run-all-compositor-stages-before-draw", "about:blank"], { stdio: "ignore" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { chrome.kill("SIGKILL"); process.exit(130); });

try {
  let targets: Target[] | null = null;
  for (let i = 0; i < 150 && !targets?.some((t) => t.type === "page"); i++) {
    await new Promise((r) => setTimeout(r, 200));
    targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json() as Promise<Target[]>).catch(() => null);
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) throw new Error("motion: Chrome never opened a page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map<number, (m: CdpReply) => void>();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data)) as CdpReply;
    if (m.method === "Runtime.exceptionThrown") console.error("page: Uncaught", m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params?.type === "error") console.error("page:", m.params.args?.map((a) => a.value ?? a.description).join(" "));
    if (m.id === undefined) return;
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  const cdp = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpReply>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression: string): Promise<unknown> => (await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: CSS_W, height: CSS_H, deviceScaleFactor: FROM > 0 ? 0.1 : DPR, mobile: false });
  await cdp("Page.enable");
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp("Page.navigate", { url });
  for (let i = 0; i < 100 && !(await evaluate("typeof window.__advance === 'function' && !!document.getElementById('stage')")); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
  await new Promise((r) => setTimeout(r, 1500));

  // Two captures per output frame, averaged: object motion blur at a 180° shutter.
  const SUB = Number(process.env.MOTION_SUB ?? (draft ? 1 : 2));
  const first = Math.round(FROM * FPS) * SUB;
  const silent = out.replace(/\.mp4$/, ".silent.mp4");
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS * SUB), "-i", "-", "-vf", `tmix=frames=${SUB},framestep=${SUB}`, "-c:v", "libx264", "-preset", draft ? "veryfast" : "slow", "-crf", "15", "-pix_fmt", "yuv420p", silent], { stdio: ["pipe", "inherit", "inherit"] });
  let frame = 0;
  for (; frame < maxSeconds * FPS * SUB; frame++) {
    await evaluate(`window.__advance(${1000 / (FPS * SUB)})`);
    if (frame < first) {
      // Still needs a frame drawn: dialogs wait on their CSS transitions, which only move when Chrome paints.
      // Drawn at a tiny pixel ratio, so the frame costs next to nothing; layout is in CSS pixels and does not change.
      if (frame % FF_EVERY === 0 || frame >= first - SUB * 4) await cdp("Page.captureScreenshot", { format: "jpeg", quality: 10, clip: { x: 0, y: 0, width: 8, height: 8, scale: 1 } });
      if (frame === first - 1) await cdp("Emulation.setDeviceMetricsOverride", { width: CSS_W, height: CSS_H, deviceScaleFactor: DPR, mobile: false });
      if (frame % 60 === 0 && (await evaluate("!!window.__done"))) break;
      continue;
    }
    const shot = await cdp("Page.captureScreenshot", { format: draft ? "jpeg" : "png", quality: draft ? 90 : undefined, clip: { x: 0, y: 0, width: CSS_W, height: CSS_H, scale: 1 } });
    ff.stdin.write(Buffer.from(shot.result?.data ?? "", "base64"));
    if (frame % 60 === 0 && (await evaluate("!!window.__done"))) break;
    if (frame % (FPS * SUB * 5) === 0) console.error(`${out.split("/").pop()}: ${(frame / FPS / SUB).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  frame = frame / SUB;
  if (process.env.MOTION_SFX_OUT) writeFileSync(process.env.MOTION_SFX_OUT, JSON.stringify({ events: ((await evaluate("window.__sfx ?? []")) ?? []) as SfxEvent[], length: frame / FPS }));
  if (process.env.MOTION_NO_AUDIO) renameSync(silent, out);
  else {
    const wav = out.replace(/\.mp4$/, ".wav");
    writeTrack(((await evaluate("window.__sfx ?? []")) ?? []) as SfxEvent[], frame / FPS, wav);
    await new Promise((r) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out], { stdio: "inherit" }).on("close", r));
    rmSync(silent, { force: true });
  }
  console.log(`${out}: ${((frame - first / SUB) / FPS).toFixed(1)} s`);
  ws.close();
} finally {
  chrome.kill("SIGKILL");
  await new Promise<void>((r) => (chrome.exitCode !== null ? r() : chrome.on("exit", () => r())));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
