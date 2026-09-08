/* eslint-env node */

// Runs the real drawsWindowButtons out of main.ts rather than restating it: a
// copy passes happily while the shipped one is wrong. GRYT-1060.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const main = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "electron", "main.ts"),
  "utf8",
);

const source = main.match(/const TILING_DESKTOPS = new Set\(\[[\s\S]*?\n\}\n(?=\n)/);

assert.ok(
  source,
  "could not find TILING_DESKTOPS and drawsWindowButtons in electron/main.ts. " +
    "If they moved or were renamed, move this check with them.",
);

// TypeScript's only contribution here is the return annotation.
const js = source[0].replace(": boolean", "");

const drawsWith = (platform, desktop) =>
  new Function("process", `${js}; return drawsWindowButtons;`)({
    platform,
    env: { XDG_CURRENT_DESKTOP: desktop },
  })();

// Hyprland is what was measured on the box; the rest are the same family.
const cases = [
  ["Hyprland", false],
  ["sway", false],
  ["i3", false],
  ["niri", false],
  // The spec allows a colon-separated list, and some sessions use one.
  ["Hyprland:wlroots", false],
  ["wlroots:sway", false],
  ["HYPRLAND", false],
  // Everything with a real titlebar keeps its buttons.
  ["GNOME", true],
  ["KDE", true],
  ["XFCE", true],
  ["ubuntu:GNOME", true],
  ["", true],
];

for (const [desktop, expected] of cases) {
  assert.equal(
    drawsWith("linux", desktop),
    expected,
    `XDG_CURRENT_DESKTOP=${JSON.stringify(desktop)} should ${expected ? "keep" : "drop"} the window buttons`,
  );
}

// The other two platforms draw their own and must never be affected.
for (const platform of ["darwin", "win32"]) {
  assert.equal(
    drawsWith(platform, "Hyprland"),
    true,
    `${platform} must keep its window buttons`,
  );
}

// And the overlay has to sit behind the predicate, not merely be defined.
assert.match(
  main,
  /\.\.\.\(drawsWindowButtons\(\)\s*\n?\s*\?\s*\{\s*\n?\s*titleBarOverlay:/,
  "titleBarOverlay is not conditional on drawsWindowButtons(), so it is set everywhere",
);

// The renderer learns the same answer through a flag on argv, and the two
// halves have to spell it identically or the titlebar silently stays.
const flag = main.match(/const NO_WINDOW_CHROME_FLAG = "([^"]+)"/);

assert.ok(flag, "main.ts no longer defines NO_WINDOW_CHROME_FLAG");

assert.match(
  main,
  /additionalArguments: drawsWindowButtons\(\)\s*\n?\s*\?\s*\[\]\s*\n?\s*:\s*\[NO_WINDOW_CHROME_FLAG\]/,
  "additionalArguments is not gated on drawsWindowButtons(), so the renderer is told the wrong thing",
);

const preload = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "electron", "preload.ts"),
  "utf8",
);

assert.ok(
  preload.includes(`process.argv.includes("${flag[1]}")`),
  `preload.ts does not read ${flag[1]} off argv, so drawsWindowChrome cannot be right`,
);

const titlebar = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "components", "titlebar.tsx"),
  "utf8",
);

// Both the strip and the inset, or the layout keeps a 36px gap for a bar that
// is not drawn.
assert.match(titlebar, /if \(!chrome\) return null;/, "the titlebar still renders without chrome");
assert.match(titlebar, /if \(chrome\) \{\s*\n\s*document\.documentElement\.style\.setProperty\(\s*\n?\s*"--titlebar-inset"/,
  "--titlebar-inset is set regardless of chrome, so the gap survives the strip");

console.log(`window buttons: ok, ${cases.length} desktops and 2 platforms`);
