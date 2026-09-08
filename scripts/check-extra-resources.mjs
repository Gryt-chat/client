/**
 * Fails the build when something listed in extraResources is not on disk.
 * electron-builder skips a missing one silently and reports success.
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { EMBEDDED_RESOURCE_PREFIX, isSlimBuild } from "./variant.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/**
 * The `from:` values out of electron-builder.yml's extraResources. Parsed by hand:
 * this runs inside electron-builder's own hook, to read six lines.
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
  const slim = isSlimBuild();

  // A slim build drops these from the config too, so demanding them would fail a
  // correct build. This skips two known names, not the whole check.
  const sources = extraResourceSources(yml).filter(
    (src) => !slim || !src.startsWith(EMBEDDED_RESOURCE_PREFIX),
  );

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
