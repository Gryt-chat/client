/* eslint-env node */

/**
 * Every layout that drops the voice panel still offers a way out of the call.
 * A source check, because the failure is a branch that renders one element too few.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const serverView = read("../src/packages/socket/src/components/serverView.tsx");
const mobileView = read("../src/packages/socket/src/components/MobileServerView.tsx");
const sheetButton = read("../src/packages/socket/src/components/VoiceSheetButton.tsx");

/* ── Both narrow layouts wire it up ─────────────────────────────────── */

assert.match(
  mobileView,
  /<VoiceSheetButton\b/,
  "the phone layout must render VoiceSheetButton — without it a call below 768 has no controls",
);

assert.match(
  serverView,
  /<VoiceSheetButton\b/,
  "the tiny window must render VoiceSheetButton — without it a call below 520 has no controls",
);

// It has to sit in the tiny branch specifically. A button landing in the phone or
// full layout would satisfy the check above and leave the tiny window broken.
const tinyBranch = serverView.slice(
  serverView.indexOf("{isTiny ? ("),
  serverView.indexOf(") : isMobile ? ("),
);
assert.ok(
  tinyBranch.length > 0,
  "could not find the tiny branch in serverView — this check needs rewriting against the new shape",
);
assert.match(
  tinyBranch,
  /<VoiceSheetButton\b/,
  "VoiceSheetButton is in serverView but not in the tiny branch",
);

/* ── One component, not two ─────────────────────────────────────────── */

// The chat is shared between these layouts for the same reason: a second copy is
// a second copy to keep in step.
for (const [name, source] of [
  ["serverView", serverView],
  ["MobileServerView", mobileView],
]) {
  assert.doesNotMatch(
    source,
    /aria-label="Leave voice channel"/,
    `${name} draws its own leave control — it should be going through VoiceSheetButton`,
  );
}

/* ── The button is gated on actually being in a call ────────────────── */

assert.match(
  sheetButton,
  /\{connected && \(/,
  "VoiceSheetButton must only draw itself while connected, or every narrow window grows a dead call button",
);

// The sheet is what holds the controls. Losing either half leaves a button that
// opens nothing, which reads exactly like the bug this fences off.
assert.match(sheetButton, /<MobileSheet\b/, "VoiceSheetButton must render the sheet");
assert.match(sheetButton, /<VoiceView\b/, "VoiceSheetButton must render VoiceView inside the sheet");

// It is reachable by name. The first measurement missed the phone layout's button
// because it carried no label, and reported a working layout as broken.
assert.match(
  sheetButton,
  /aria-label="[^"]+"/,
  "the call button needs a label — an icon-only button with no name is invisible to a screen reader",
);

console.log("check-call-controls: ok");
