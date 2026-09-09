/* eslint-env node */

// CSS zoom scales a rect and leaves the viewport alone, so every menu landed
// `scale` times too far down. Chromium's own zoom does not (GRYT-1127).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const main = read("src/main.tsx");
const lib = read("src/lib/electron.ts");
const preload = read("electron/preload.ts");

/** Everything from `opener` to the brace that closes the block it opens. */
function block(text, opener, what) {
  const at = text.indexOf(opener);
  assert.ok(at >= 0, `no longer has ${what}`);
  const start = at + opener.length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start + 1, i);
  }
  throw new Error(`unbalanced braces in ${what}`);
}

/* The effect that applies the scale, stopping before the chat font size it also
   sets: that one is unrelated and needs an argument this does not have. */
const from = main.indexOf("const root = document.documentElement;\n    const native");
assert.ok(from >= 0, "src/main.tsx no longer asks for a native zoom");
const until = main.indexOf('root.style.setProperty("--chat-font-size', from);
const body = main.slice(from, until);

const apply = new Function("setNativeZoom", "uiScale", "document", body);
const documentWith = (root) => ({ documentElement: root });

/** A stand-in for documentElement.style that records what was written. */
function fakeRoot() {
  const props = {};
  return {
    props,
    style: {
      zoom: "untouched",
      setProperty(name, value) {
        props[name] = value;
      },
    },
  };
}

// ── in the desktop app, Chromium scales and CSS does none of it ─────────────
for (const scale of [1, 1.25, 1.5, 0.8]) {
  const asked = [];
  const r = fakeRoot();
  apply((f) => (asked.push(f), true), scale, documentWith(r));
  assert.deepEqual(asked, [scale], `native zoom was not asked for ${scale}`);
  assert.equal(r.style.zoom, "", `CSS zoom still set at ${scale}, so both would apply`);
  assert.equal(r.props["--gryt-ui-scale"], "1", "the viewport correction is for CSS zoom only");
}

// ── a browser has nothing native, so the old path stays ─────────────────────
for (const scale of [1.25, 0.8]) {
  const r = fakeRoot();
  apply(() => false, scale, documentWith(r));
  assert.equal(r.style.zoom, String(scale), "a browser lost its only way to scale");
  assert.equal(r.props["--gryt-ui-scale"], String(scale), "the viewport correction went missing");
}

/* ── the bridge, run rather than read ────────────────────────────────────── */

assert.match(preload, /webFrame\.setZoomFactor\(factor\)/, "preload no longer sets a zoom factor");

const setNativeZoom = new Function(
  "getElectronAPI",
  "factor",
  block(lib, "export function setNativeZoom(factor: number): boolean {", "setNativeZoom"),
);

/* Answering false rather than throwing is what lets main.tsx fall back, so a
   page with no bridge at all has to come back false. */
assert.equal(setNativeZoom(() => null, 1.5), false, "no API should answer false");
assert.equal(setNativeZoom(() => ({}), 1.5), false, "an API without the method should answer false");

{
  const calls = [];
  const used = setNativeZoom(() => ({ setZoomFactor: (f) => calls.push(f) }), 1.25);
  assert.equal(used, true, "an API that can scale should report that it did");
  assert.deepEqual(calls, [1.25], "the factor did not reach the bridge");
}

console.log("ui scale: native where there is one, CSS only in a browser");
