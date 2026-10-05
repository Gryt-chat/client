#!/usr/bin/env node
/**
 * The desktop media sandbox's pure parts: sniffing, the box maths, the animated WebP it puts
 * together, and the checks on jobs the image worker sends (GRYT-1664).
 */

import assert from "node:assert/strict";

import {
  buildAnimatedWebp,
  dominantColour,
  imageBox,
  parseMediaRequest,
  place,
  sniffImage,
} from "../electron/mediaSandboxFormat.ts";

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

assert.equal(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
assert.equal(sniffImage(bytes([0x89], "PNG\r\n\x1a\n")), "image/png");
assert.equal(sniffImage(bytes("GIF89a")), "image/gif");
assert.equal(sniffImage(bytes("RIFF", [0, 0, 0, 0], "WEBP")), "image/webp");
assert.equal(sniffImage(bytes([0, 0, 0, 0x1c], "ftypavif")), "image/avif");
assert.equal(sniffImage(bytes("<svg xmlns=")), null, "an SVG is never a picture here");
assert.equal(sniffImage(bytes([0, 0, 0, 0x1c], "ftypisom")), null, "an MP4 is not a picture");

// Cover fills the box exactly from the middle of the source.
assert.deepEqual(place(2000, 1000, "cover", 256, 256), { width: 256, height: 256, sx: 500, sy: 0, sw: 1000, sh: 1000 });
// Inside never enlarges.
assert.deepEqual(place(100, 50, "inside", 4096, 4096), { width: 100, height: 50, sx: 0, sy: 0, sw: 100, sh: 50 });
assert.equal(place(8000, 2000, "inside", 4096, 4096).width, 4096);
assert.deepEqual(imageBox("upload", true), { width: 1024, height: 1024 });
assert.deepEqual(imageBox("banner", false), { width: 960, height: 492 });

function riff(...chunks) {
  const body = chunks.flatMap(([fourcc, data]) => {
    const size = [data.length & 0xff, (data.length >> 8) & 0xff, 0, 0];
    return [...bytes(fourcc), ...size, ...data, ...(data.length & 1 ? [0] : [])];
  });
  const total = body.length + 4;
  return bytes("RIFF", [total & 0xff, (total >> 8) & 0xff, 0, 0], "WEBP", body);
}

const lossy = riff(["VP8 ", [1, 2, 3]]);
const withAlpha = riff(["VP8X", new Array(10).fill(0)], ["ALPH", [9]], ["VP8 ", [1, 2, 3, 4]]);
const out = buildAnimatedWebp([{ webp: lossy, durationMs: 100 }, { webp: withAlpha, durationMs: 40 }], 300, 200);
const view = new DataView(out.buffer);
const tag = (at) => String.fromCharCode(...out.subarray(at, at + 4));
assert.equal(tag(0), "RIFF");
assert.equal(view.getUint32(4, true), out.length - 8, "RIFF size covers the file");
assert.equal(tag(8), "WEBP");
assert.equal(tag(12), "VP8X");
assert.equal(out[20] & 0x02, 0x02, "animation flag");
assert.equal(out[20] & 0x10, 0x10, "alpha flag, since a frame had alpha");
assert.equal(out[24] | (out[25] << 8) | (out[26] << 16), 299);
assert.equal(out[27] | (out[28] << 8) | (out[29] << 16), 199);
const found = [];
for (let at = 30; at < out.length; ) {
  const size = view.getUint32(at + 4, true);
  found.push(tag(at));
  if (tag(at) === "ANMF") {
    const d = at + 8;
    assert.equal(out[d + 6] | (out[d + 7] << 8) | (out[d + 8] << 16), 299, "frame covers the canvas");
    assert.equal(out[d + 15], 0b10, "no blending, no disposal");
    assert.ok(!String.fromCharCode(...out.subarray(d, d + size)).includes("VP8X"), "no VP8X inside a frame");
  }
  at += 8 + size + (size & 1);
}
assert.deepEqual(found, ["ANIM", "ANMF", "ANMF"]);
assert.throws(() => buildAnimatedWebp([], 1, 1));
assert.throws(() => buildAnimatedWebp([{ webp: bytes("RIFF", [4, 0, 0, 0], "WEBP"), durationMs: 1 }], 1, 1), /no image data/);
assert.throws(() => buildAnimatedWebp([{ webp: bytes("RIFF", [99, 0, 0, 0], "WEBP", "VP8 ", [200, 0, 0, 0]), durationMs: 1 }], 1, 1), /Truncated/);

const job = { kind: "image", use: "avatar", bytes: new Uint8Array([1]) };
assert.deepEqual(parseMediaRequest({ type: "gryt-media-job", id: 3, job }), { id: 3, job });
assert.equal(parseMediaRequest({ type: "gryt-media-job", id: 3, job: { ...job, use: "../etc" } }), null);
assert.equal(parseMediaRequest({ type: "gryt-media-job", id: 3, job: { ...job, kind: "video", use: "upload" } }), null, "only banners and avatars are videos");
assert.equal(parseMediaRequest({ type: "gryt-media-job", id: 3, job: { ...job, bytes: [1, 2] } }), null);
assert.equal(parseMediaRequest({ type: "gryt-media-job", id: 1.5, job }), null);
assert.equal(parseMediaRequest({ type: "other", id: 3, job }), null);
assert.equal(parseMediaRequest(null), null);

const red = [255, 0, 0, 255];
const blue = [0, 0, 255, 255];
const clear = [0, 255, 0, 0];
assert.equal(dominantColour(new Uint8Array([...red, ...red, ...blue, ...clear, ...clear, ...clear])), "#ff0000");
assert.equal(dominantColour(new Uint8Array(clear)), null, "a see-through picture has no colour");

console.log("media sandbox: ok");
