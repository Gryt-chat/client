/* eslint-env node */

/**
 * Exporting an owl to a file, checked without a browser.
 *
 * The SVG path and the filename are pure and are checked here. The raster paths
 * need a canvas, so they are checked in a real headless Chromium by
 * `scripts/check-owl-export-raster.mjs` — this one is the part that can run in
 * CI on every push without a browser download.
 *
 * The code under test ships in @gryt/ui as of GRYT-641, so this checks the
 * copy the client actually installs rather than a file in this repository.
 */

import assert from "node:assert/strict";

import { decodeWorn, encodeWorn } from "@gryt/owl";

import {
  EXPORT_FORMATS,
  EXPORT_SIZE,
  exportFilename,
  renderOwl,
} from "@gryt/ui";

const look = decodeWorn(
  encodeWorn({ palette: "teal", scheme: "day", ears: "tufts", wearing: {} }),
);
assert.ok(look, "the look under test should decode");

// SVG is offered first, deliberately: it is what the generator produces and the
// only one of the four with no resolution to get wrong.
assert.equal(EXPORT_FORMATS[0].id, "svg");
assert.equal(EXPORT_SIZE, 1024);

// Every format has to be distinct in all three of the things a save uses.
const ids = EXPORT_FORMATS.map((f) => f.id);
assert.equal(new Set(ids).size, ids.length, "duplicate format id");
const extensions = EXPORT_FORMATS.map((f) => f.extension);
assert.equal(new Set(extensions).size, extensions.length, "duplicate extension");
const mimes = EXPORT_FORMATS.map((f) => f.mime);
assert.equal(new Set(mimes).size, mimes.length, "duplicate mime");

// JPEG's extension is jpg, which is what people expect to see on a file.
assert.equal(EXPORT_FORMATS.find((f) => f.id === "jpeg").extension, "jpg");

const svg = EXPORT_FORMATS[0];
const blob = await renderOwl("sivert", look, svg);
assert.equal(blob.type, "image/svg+xml");

const text = await blob.text();
assert.ok(text.startsWith("<svg"), "an SVG export should be an SVG");
assert.ok(text.includes('viewBox="0 0 1024 1024"'), "the frame the generator draws on");
assert.ok(text.includes(`width="${EXPORT_SIZE}"`), "written at the export size");
assert.ok(text.trimEnd().endsWith("</svg>"), "and a complete one");

// Small enough to be worth offering as the first option.
assert.ok(text.length < 200_000, `an owl SVG should be small, got ${text.length} bytes`);

// The same seed and look give the same file, which is the property the whole
// generator rests on and is worth asserting where a file leaves the app.
assert.equal(await (await renderOwl("sivert", look, svg)).text(), text);

// Filenames.
assert.equal(exportFilename("Sivert", EXPORT_FORMATS[1]), "sivert-owl.png");
assert.equal(exportFilename("Sivert", svg), "sivert-owl.svg");
assert.equal(exportFilename("  Ola Nordmann  ", svg), "ola-nordmann-owl.svg");
// Nothing a filesystem will refuse, and never an empty name.
assert.equal(exportFilename("../../etc/passwd", svg), "etc-passwd-owl.svg");
assert.equal(exportFilename("???", svg), "gryt-owl.svg");
assert.equal(exportFilename("", svg), "gryt-owl.svg");
assert.ok(!exportFilename("a".repeat(200), svg).includes("/"));
assert.ok(exportFilename("a".repeat(200), svg).length < 50);

console.log("owl export ok");
