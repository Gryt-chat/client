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

console.log(`window buttons: ok, ${cases.length} desktops and 2 platforms`);
