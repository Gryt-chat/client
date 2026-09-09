/* eslint-env node */

// Gryt does not put itself on top of what somebody is doing. Raising the window
// above every other window is the part a fullscreen game cannot beat. GRYT-1105.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN = "electron/main.ts";
const main = readFileSync(join(root, MAIN), "utf8");

/** Everything from `opener` to the brace that closes the block it opens. */
function block(text, opener, what) {
  const at = text.indexOf(opener);
  assert.ok(at >= 0, `${MAIN} no longer has ${what}`);
  const start = at + opener.length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${what}`);
}

// The one the startup path calls. Showing and focusing is fine — somebody is
// waiting for it. Forcing it above everything else is not.
const showMain = block(main, "function showMain(): void {", "showMain");
assert.doesNotMatch(
  showMain,
  /setAlwaysOnTop/,
  "showMain raises the window above every other window, which lands on top of a fullscreen game",
);
assert.match(showMain, /mainWindow\.show\(\)/, "showMain no longer shows the window");

/* Only the notification click may raise the window: somebody clicked it, so
   they are asking for the window. Everything else that does it is a bug. */
const allowed = ["win.setAlwaysOnTop("];
const raises = [...main.matchAll(/^.*setAlwaysOnTop\(/gm)]
  .map((m) => m[0].trim())
  .filter((line) => !allowed.some((ok) => line.includes(ok)));

assert.deepEqual(
  raises,
  [],
  `these raise a window above every other window:\n  ${raises.join("\n  ")}`,
);

console.log("focus steal: ok, nothing raises the main window above other apps");
