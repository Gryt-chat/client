/* eslint-env node */

// The note has to fit, be dismissable, and be reachable again once it has been seen.
// Sivert: "the current hwats new modal doesnt allow scrolling". GRYT-1145.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const DIALOG = "src/packages/socket/src/components/WhatsNewDialog.tsx";
const WHATS_NEW = "src/components/whatsNew.tsx";
const ABOUT = "src/packages/settings/src/components/aboutSettings.tsx";
const STYLE = "src/style.css";

const dialog = read(DIALOG);
const whatsNew = read(WHATS_NEW);
const about = read(ABOUT);
const style = read(STYLE);

/* It fits the window. Without a cap the card grew with the note and ran off both
   ends of the screen, taking the greeting and the Done button with it. */
{
  assert.ok(/maxHeight:/.test(dialog), `${DIALOG} has no maximum height, so a long note runs off the screen`);
  assert.ok(/100vh/.test(dialog), `${DIALOG} caps its height against something other than the window`);
  assert.ok(
    /flexDirection: "column"/.test(dialog),
    `${DIALOG} is not a column, so the body cannot take the leftover room`,
  );
}

/** One CSS rule's declarations. */
function rule(selector) {
  const at = style.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${STYLE} no longer has ${selector}. Move this check with it.`);
  return style.slice(at, style.indexOf("}", at));
}

// The body scrolls, and the footer holding the way out never shrinks.
{
  const pad = rule(".whats-new-pad");
  assert.ok(/overflow-y:\s*auto/.test(pad), ".whats-new-pad does not scroll, so a long note is unreachable");
  assert.ok(
    /min-height:\s*0/.test(pad),
    ".whats-new-pad has no min-height: 0, and a flex child will not shrink below its content without it",
  );
  assert.ok(/flex:\s*1/.test(pad), ".whats-new-pad does not take the leftover room");

  const foot = rule(".whats-new-foot");
  assert.ok(/flex:\s*none/.test(foot), ".whats-new-foot can shrink, and it holds the only way out");
}

/* Dismissable by clicking away. AlertDialog ignores an outside press by design,
   which is right for a decision and wrong for something you are only being told. */
{
  assert.ok(
    !/AlertDialog/.test(dialog),
    `${DIALOG} is an AlertDialog again, which refuses to close on an outside click`,
  );
  assert.ok(/<Dialog\.Root/.test(dialog), `${DIALOG} no longer opens a Dialog`);
}

/* Reachable after it has been seen. The whole point of the About button, and it is
   worth nothing if the effect still returns early on the version it has recorded. */
{
  /* Called, not merely imported. Deleting the button and leaving the import behind
     is exactly what a looser match lets through. */
  assert.ok(
    /onClick=\{requestWhatsNew\}/.test(about),
    `${ABOUT} has no button that asks for the note, so one already seen is gone for good`,
  );

  const asked = whatsNew.match(/if \(!asked && seen === version\) return;/);
  assert.ok(asked, `${WHATS_NEW} returns early on the version already seen, even when asked`);

  const fresh = whatsNew.match(/if \(!asked && seen === null && !hasJoinedAnything\(\)\)/);
  assert.ok(fresh, `${WHATS_NEW} stays quiet on a fresh install even when asked`);

  assert.ok(
    /\[version, storeUser, asked\]/.test(whatsNew),
    `${WHATS_NEW} does not re-run when somebody asks, so the button does nothing`,
  );
}

/* Asking twice in a row reopens it twice. A flag would latch and the second press
   would do nothing, which reads as the button being broken. */
{
  const store = read("src/packages/socket/src/hooks/whatsNewRequest.ts");
  assert.ok(/requested \+= 1/.test(store), "the request store latches instead of counting");
  assert.ok(!/= true/.test(store), "the request store looks like a boolean flag");
}

console.log("whats new: ok, it fits, it closes, and it can be asked for again");
