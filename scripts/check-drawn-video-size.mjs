/* eslint-env node */

// What a viewer tells the SFU about each remote video: the largest size it's drawn at, zero when
// nothing can see it, and never its own self-view (GRYT-1432).

import assert from "node:assert/strict";

import { drawnBox, setDrawnVideoReporter, watchDrawnSize } from "../src/packages/socket/src/lib/drawnVideoSize.ts";

// Contain fits inside the element; cover overflows it one way.
assert.deepEqual(drawnBox({ width: 1000, height: 1000 }, { width: 1600, height: 900 }, "contain"), { width: 1000, height: 562.5 });
assert.deepEqual(drawnBox({ width: 900, height: 900 }, { width: 1600, height: 900 }, "cover"), { width: 1600, height: 900 });
assert.deepEqual(drawnBox({ width: 0, height: 300 }, { width: 1600, height: 900 }, "cover"), { width: 0, height: 0 });
assert.deepEqual(drawnBox({ width: 640, height: 360 }, { width: 0, height: 0 }, "contain"), { width: 640, height: 360 }, "no frame yet should count as the element's box");

/** A window and a video element, just enough for the watcher, with the observers held for poking. */
function fakeWindow() {
  const win = {
    devicePixelRatio: 2,
    document: { visibilityState: "visible", listeners: new Set(), addEventListener: (_e, f) => win.document.listeners.add(f), removeEventListener: (_e, f) => win.document.listeners.delete(f) },
    resizers: [],
    intersectors: [],
    ResizeObserver: class { constructor(f) { this.f = f; win.resizers.push(this); } observe() {} disconnect() { this.gone = true; } },
    IntersectionObserver: class { constructor(f) { this.f = f; win.intersectors.push(this); } observe() {} disconnect() { this.gone = true; } },
    matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => 0,
  };
  return win;
}
function fakeVideo(win, width, height) {
  return { ownerDocument: { defaultView: win }, isConnected: true, clientWidth: width, clientHeight: height, videoWidth: 1920, videoHeight: 1080, addEventListener() {}, removeEventListener() {} };
}

const reports = [];
const last = (id) => reports.filter(([s]) => s === id).at(-1)?.[1];
setDrawnVideoReporter((id, size) => reports.push([id, size && { width: size.width, height: size.height }]), ["theirs", "idle"]);

// A remote stream drawn nowhere is hidden, so the sender can pause it.
assert.deepEqual(last("idle"), { width: 0, height: 0 });

const win = fakeWindow();
const small = watchDrawnSize(fakeVideo(win, 320, 180), "theirs", "cover");
const big = watchDrawnSize(fakeVideo(win, 1600, 900), "theirs", "contain");
assert.deepEqual(last("theirs"), { width: 3200, height: 1800 }, "the largest place it's drawn, in device pixels");
big();
assert.deepEqual(last("theirs"), { width: 640, height: 360 }, "closing the big view didn't lower it");

// Scrolled out of view, then the whole window hidden.
win.intersectors[0].f([{ isIntersecting: false }]);
assert.deepEqual(last("theirs"), { width: 0, height: 0 }, "a tile scrolled away still counted");
win.intersectors[0].f([{ isIntersecting: true }]);
win.document.visibilityState = "hidden";
for (const f of win.document.listeners) f();
assert.deepEqual(last("theirs"), { width: 0, height: 0 }, "a hidden window still counted");
small();

// Our own self-view: drawn, but never reported, or it would keep our own video from pausing.
const before = reports.length;
const self = watchDrawnSize(fakeVideo(fakeWindow(), 1600, 900), "mine", "cover");
assert.equal(reports.filter(([s]) => s === "mine").length, 0, "the self-view was reported");
self();
assert.ok(reports.length >= before);

// A stream that leaves is forgotten rather than reported hidden.
setDrawnVideoReporter((id, size) => reports.push([id, size]), ["idle"]);
assert.equal(last("theirs"), null, "a stream that left the call wasn't forgotten");

console.log("drawn video size: ok");
