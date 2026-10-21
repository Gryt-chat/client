/**
 * Builds gryt-voice (GRYT-1837), the native voice engine's process, from @gryt/voice's sources.
 * macOS only for now: Windows needs Winsock in the engine first. Usage: node scripts/build-voice-helper.ts [--out dir]
 */

import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The binary's path, or null where it isn't built yet. On a Mac it's universal, so the arch doesn't matter. */
export function buildVoiceHelper({
  platform = process.platform,
  out = join(CLIENT_DIR, "build", "voice", process.arch),
}: { platform?: string; out?: string } = {}): string | null {
  if (platform !== "darwin") return null;
  mkdirSync(out, { recursive: true });
  const file = join(resolve(out), "gryt-voice");
  execFileSync("node", [join(CLIENT_DIR, "node_modules", "@gryt", "voice", "native", "tools", "build-helper.mjs"), file], { stdio: "inherit" });
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--out");
  console.log(buildVoiceHelper({ out: at === -1 ? undefined : process.argv[at + 1] }) ?? `gryt-voice isn't built on ${process.platform} yet`);
}
