/* eslint-env node */

/**
 * Every layout that drops the voice panel still offers a way out of the call
 * (GRYT-716).
 *
 * Two layouts are too narrow to draw the panel. The phone layout below 768 has
 * always dropped it, and the one-channel window added by GRYT-714 drops it
 * below 520. Dropping the panel drops mute, deafen and leave with it, and none
 * of that ends the call — measured on the desktop app at 450px, the whole
 * window held five buttons and the microphone was still open. The way out was
 * to make the window bigger, which is not what you want to be looking for while
 * you are the one being heard.
 *
 * A source check, because the failure is a branch that renders one element too
 * few. There is nothing to call and no value to compare — the layout is either
 * wired to the button or it is not, and a pure function cannot see which.
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

// It has to sit in the tiny branch specifically. `serverView` also renders the
// phone layout and the full one, and both of those are already covered — the
// full layout by the panel itself, the phone layout by `MobileServerView`. A
// button that landed in either of those would satisfy the check above while
// leaving the tiny window exactly as broken as it was.
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

// The chat is shared between these layouts for the same reason: a second copy
// is a second copy to keep in step. Call controls are worse than a chat to get
// wrong, so neither layout is allowed to grow its own.
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

// It is reachable by name. The first measurement of this bug missed the phone
// layout's button entirely because it carried no label, and reported a working
// layout as broken.
assert.match(
  sheetButton,
  /aria-label="[^"]+"/,
  "the call button needs a label — an icon-only button with no name is invisible to a screen reader",
);

console.log("check-call-controls: ok");
