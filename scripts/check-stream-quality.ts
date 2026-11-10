// The quality pill on a share tile: what it calls a stream, and what its tooltip lists.

import assert from "node:assert/strict";

import type { InboundDiagnostics } from "../src/components/videoDebugStats.ts";

const { qualityDetails, qualityPill, resolutionLabel } = await import(
  "../src/packages/socket/src/components/streamQuality.ts"
);

assert.equal(resolutionLabel(2160), "4K");
assert.equal(resolutionLabel(1440), "1440p");
assert.equal(resolutionLabel(1032), "1080p", "a window share a little short of 1080 still reads as 1080p");
assert.equal(resolutionLabel(720), "720p");
assert.equal(resolutionLabel(480), "480p");
assert.equal(resolutionLabel(360), "360p");

const base = {
  id: "i", trackId: "t", codec: "video/AV1", frameWidth: 1920, frameHeight: 1080, framesPerSecond: 239.6,
  bitrateKbps: 18_240, jitterMs: 3.6, recentLossPct: 0.25, recentDropPct: 12.4, freezeCount: 0,
} as InboundDiagnostics;

assert.deepEqual(qualityPill(base), { resolution: "1080p", fps: "240 fps" });
assert.equal(qualityPill({ ...base, frameHeight: null }), null, "no pill before the first frame");
assert.equal(qualityPill(undefined), null);

assert.deepEqual(qualityDetails(base), [
  ["Size", "1920 × 1080"],
  ["Frame rate", "240 fps"],
  ["Codec", "AV1"],
  ["Bitrate", "18.2 Mbit/s"],
  ["Packet loss", "0.3%"],
  ["Dropped frames", "12%"],
  ["Jitter", "4 ms"],
  ["Freezes", "none"],
]);
assert.deepEqual(
  qualityDetails({ ...base, bitrateKbps: 640, recentLossPct: null, freezeCount: 3 }).filter(([k]) => ["Bitrate", "Packet loss", "Freezes"].includes(k)),
  [["Bitrate", "640 kbit/s"], ["Packet loss", "–"], ["Freezes", "3"]],
);

console.log("stream quality: ok");
