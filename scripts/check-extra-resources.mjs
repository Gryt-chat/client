/**
 * Fails the build when something listed in extraResources is not on disk.
 *
 * electron-builder skips a missing extraResource silently. It does not warn and
 * it does not fail — it packages the app without the file and reports success.
 *
 * That shipped v1.4.0-beta.5 with no menu bar icon. build/trayTemplate*.png are
 * generated rather than authored, `build/*` is in .gitignore, so `git add -A`
 * skipped them and they were never committed. The local build worked because
 * the files happened to exist on the machine that generated them; CI had no such
 * files, packaged without them, and the released app had a tray with nothing in
 * it. Nothing anywhere said so.
 *
 * Wired in as electron-builder's beforeBuild hook, so it runs no matter how the
 * build was started — CI invokes `npx electron-builder` directly and never calls
 * the package.json build script.
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/**
 * The `from:` values out of electron-builder.yml's extraResources.
 *
 * Parsed by hand rather than with a YAML dependency: this runs inside
 * electron-builder's own hook, and adding a parser to the build's critical path
 * to read six lines is not a trade worth making.
 */
function extraResourceSources(yml) {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => l.trim() === "extraResources:");
  if (start === -1) return [];

  const out = [];
  for (const line of lines.slice(start + 1)) {
    // Any non-indented, non-empty line ends the block.
    if (line.trim() && !/^\s/.test(line)) break;
    const m = line.match(/^\s*-?\s*from:\s*(.+?)\s*$/);
    if (m) out.push(m[1].replace(/^["']|["']$/g, ""));
  }
  return out;
}

export default async function beforeBuild() {
  const yml = readFileSync(join(root, "electron-builder.yml"), "utf8");
  const sources = extraResourceSources(yml);

  const missing = [];
  const empty = [];
  for (const src of sources) {
    // ${os}/${arch} placeholders are resolved per target by electron-builder,
    // so this cannot check them without duplicating that logic.
    if (src.includes("${")) continue;
    const full = join(root, src);
    if (!existsSync(full)) missing.push(src);
    else if (statSync(full).isFile() && statSync(full).size === 0) empty.push(src);
  }

  if (missing.length || empty.length) {
    const lines = [
      "extraResources listed in electron-builder.yml are not on disk.",
      "electron-builder would skip these silently and package without them.",
      "",
      ...missing.map((m) => `  missing: ${m}`),
      ...empty.map((m) => `  empty:   ${m}`),
      "",
      "If they are generated, run `yarn icons:generate` and commit the result.",
    ];
    throw new Error(lines.join("\n"));
  }

  console.log(`  extraResources: ${sources.length} entries, all present`);
  return true;
}
