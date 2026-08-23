/* eslint-env node */

/**
 * The combo grammar in src/lib/hotkeys.ts, checked without a browser.
 *
 * Three sides read these strings: the settings UI that writes them, the
 * renderer listeners that match them, and the Electron main process that hands
 * them to uiohook. They are also persisted, so a changed token silently
 * unbinds whatever people already had. Node 24 strips the types on import.
 */

import assert from "node:assert/strict";

import * as hotkeys from "../src/lib/hotkeys.ts";

const {
  buildKeyCombo,
  parseCombo,
  buildMouseCombo,
  comboMouseButton,
  formatCombo,
  HOTKEY_ACTIONS,
  matchesKeyEvent,
  matchesMouseEvent,
  releasesKeyEvent,
  releasesMouseEvent,
} = hotkeys;

const key = (code, mods = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

const mouse = (button, mods = {}) => ({
  button,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

// Binding.
assert.equal(buildKeyCombo(key("KeyM")), "KeyM");
assert.equal(buildKeyCombo(key("KeyM", { ctrl: true, shift: true })), "Ctrl+Shift+KeyM");
assert.equal(buildKeyCombo(key("ShiftLeft", { shift: true })), "Shift");

// The DOM numbers mouse buttons differently from everyone else: its 1 is the
// middle button and its 3 and 4 are the side ones.
assert.equal(buildMouseCombo(mouse(1)), "Mouse3");
assert.equal(buildMouseCombo(mouse(3)), "Mouse4");
assert.equal(buildMouseCombo(mouse(4)), "Mouse5");
assert.equal(buildMouseCombo(mouse(1, { alt: true })), "Alt+Mouse3");

// Left and right click are not bindable — uiohook does not swallow the event,
// so a left-click binding would key the microphone on every click in the OS.
assert.equal(buildMouseCombo(mouse(0)), null);
assert.equal(buildMouseCombo(mouse(2)), null);

// Display.
assert.equal(formatCombo(""), "Not set");
assert.equal(formatCombo("Ctrl+KeyM"), "Ctrl + M");
assert.equal(formatCombo("Digit4"), "4");
assert.equal(formatCombo("Escape"), "Esc");
assert.equal(formatCombo("Alt+Mouse4"), "Alt + Mouse 4");

// Matching a press is exact.
assert.ok(matchesKeyEvent(key("KeyM", { ctrl: true }), "Ctrl+KeyM"));
assert.ok(!matchesKeyEvent(key("KeyM"), "Ctrl+KeyM"));
assert.ok(!matchesKeyEvent(key("KeyM"), "Mouse4"));
assert.ok(matchesMouseEvent(mouse(3), "Mouse4"));
assert.ok(!matchesMouseEvent(mouse(4), "Mouse4"));
assert.ok(!matchesMouseEvent(mouse(3), "KeyM"));
assert.ok(!matchesMouseEvent(mouse(3), ""));

// Matching a release ignores the modifiers. Letting go of Shift before the key
// is normal, and a push-to-talk that missed the release would stay open.
assert.ok(releasesKeyEvent(key("KeyM"), "Ctrl+KeyM"));
assert.ok(releasesMouseEvent(mouse(3), "Shift+Mouse4"));
assert.ok(!releasesMouseEvent(mouse(0), "Shift+Mouse4"));

// Used by the main process to parse a binding, and by the renderer to decide
// whether a binding types anything while a text field has focus.
assert.equal(comboMouseButton("Ctrl+Mouse5"), 5);
assert.equal(comboMouseButton("Ctrl+KeyM"), null);
assert.equal(comboMouseButton(""), null);

assert.deepEqual(HOTKEY_ACTIONS, ["ptt", "mute", "deafen", "disconnect"]);

// The Electron main process parses stored combos with this and hands the
// result to uiohook, so a key binding has to come back as a DOM code it can
// look up and a mouse binding as a physical button number.
assert.equal(parseCombo(""), null);
assert.deepEqual(parseCombo("KeyM"), {
  code: "KeyM",
  mouseButton: null,
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
});
assert.deepEqual(parseCombo("Ctrl+Alt+KeyM"), {
  code: "KeyM",
  mouseButton: null,
  ctrl: true,
  shift: false,
  alt: true,
  meta: false,
});
assert.deepEqual(parseCombo("Shift+Mouse5"), {
  code: null,
  mouseButton: 5,
  ctrl: false,
  shift: true,
  alt: false,
  meta: false,
});

console.log("hotkey combos ok");
