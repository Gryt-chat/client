// Renders motion.html in slices at once and joins them: node scripts/render-motion-parallel.ts out.mp4 [seconds] [workers]
// The clock is virtual, so each worker fast-forwards to its slice without screenshots and the seams match.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

import { writeTrack } from "./motion-sfx.ts";

const out = process.argv[2] ?? "motion.mp4";
const seconds = Number(process.argv[3] ?? 120);
const workers = Number(process.argv[4] ?? 4);
const FPS = Number(process.env.MOTION_FPS ?? 60);
const here = new URL(".", import.meta.url).pathname;
const kids = new Set<ChildProcess>();
const run = (cmd: string, args: string[], env: Record<string, string> = {}) => new Promise<void>((ok, fail) => {
  const k = spawn(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  kids.add(k);
  k.on("close", (c) => { kids.delete(k); c ? fail(new Error(`${cmd} exited ${c}`)) : ok(); });
});
// One failed slice fails the render; the others are stopped (SIGINT, so each one closes its own Chrome).
const stopAll = () => { for (const k of kids) k.kill("SIGINT"); };

const up = () => fetch("http://localhost:3778/motion.html").then(() => true, () => false);
// A server still on the port would take the requests and then die mid-render, so wait for it to go.
spawn("pkill", ["-f", "motion.vite.config.ts"]);
for (let i = 0; i < 50 && (await up()); i++) await new Promise((r) => setTimeout(r, 200));
const vite = spawn("node", ["node_modules/vite/bin/vite.js", "--config", "motion.vite.config.ts"], { cwd: `${here}..`, stdio: "ignore" });
vite.on("exit", (c) => { if (c !== null) { console.error(`vite exited ${c}`); process.exit(1); } });
try {
  for (let i = 0; i < 100 && !(await up()); i++) await new Promise((r) => setTimeout(r, 300));
  // Slices start on whole frames, so no frame is drawn twice or skipped at a seam.
  const cut = (i: number) => Math.round((seconds * i) / workers * FPS) / FPS;
  const parts = Array.from({ length: workers }, (_, i) => out.replace(/\.mp4$/, `.part${i}.mp4`));
  const sfx = out.replace(/\.mp4$/, ".sfx.json");
  const started = Date.now();
  await Promise.all(parts.map(async (p, i) => {
    await new Promise((r) => setTimeout(r, i * 1500));
    return run("node", [`${here}render-motion.ts`, p, String(cut(i + 1))], {
      MOTION_FROM: String(cut(i)), MOTION_NO_AUDIO: "1", MOTION_PORT: String(9400 + i), ...(i === workers - 1 ? { MOTION_SFX_OUT: sfx } : {}),
    });
  })).catch((e) => { stopAll(); throw e; });
  const list = out.replace(/\.mp4$/, ".parts.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  const silent = out.replace(/\.mp4$/, ".silent.mp4");
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);
  const { events, length } = JSON.parse(readFileSync(sfx, "utf8"));
  const wav = out.replace(/\.mp4$/, ".wav");
  writeTrack(events, length, wav);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
  for (const f of [...parts, list, silent, sfx]) rmSync(f, { force: true });
  console.log(`${out}: ${length.toFixed(1)} s in ${((Date.now() - started) / 1000).toFixed(0)} s with ${workers} workers`);
} finally {
  vite.removeAllListeners("exit");
  vite.kill();
}
