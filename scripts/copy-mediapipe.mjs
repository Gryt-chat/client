/**
 * Copies MediaPipe's WASM into public/ so it is served locally.
 *
 * It cannot be fetched from Google's CDN at runtime: the desktop app runs under
 * a CSP that blocks it, and a feature that only works with an internet
 * connection to a third party is not one to build into a voice client.
 *
 * Copied rather than committed because it is about 12 MB of binary that changes
 * with the dependency. public/mediapipe is gitignored for the same reason
 * build/ is.
 */
import { cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = join(root, "public", "mediapipe");

if (!existsSync(from)) {
  console.error("@mediapipe/tasks-vision is not installed — run yarn install");
  process.exit(1);
}

mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log(`  public/mediapipe  <- ${from.replace(root + "/", "")}`);
