/** GRYT-1663. A line a second about the call, for the bug report: deltas, gaps and the cap. */

import assert from "node:assert/strict";

const { formatCallSample, startCallTimeline, recordCallSample, endCallTimeline, callTimeline } = await import(
  "../src/lib/reports/callTimeline.ts"
);

const base = {
  socketRttMs: 37.4,
  rttMs: 1,
  jitterMs: 1,
  jitterBufferMs: 40,
  packetsLost: 1,
  bitrateKbps: 32.2,
  estimatedRoundTripMs: 21,
  visible: true,
  focused: false,
};

assert.equal(
  formatCallSample(5, base, null),
  "+5s | socket 37ms | rtt 1ms jitter 1ms buffer 40ms | lost 1 | 32kbps | est 21ms | visible",
);
assert.match(formatCallSample(6, { ...base, packetsLost: 4, visible: false }, base), /lost \+3 .*\| hidden$/);
assert.match(formatCallSample(7, { ...base, socketRttMs: null, rttMs: null }, base), /socket \? \| rtt \?/);
// On the own transport its own numbers go in too, since the rest of the line is WebRTC's.
assert.match(formatCallSample(8, { ...base, transportBufferedMs: 44.6, transportRttMs: 3 }, base), /32kbps \| own buffer 45ms rtt 3ms made up \? \| est/);
assert.match(formatCallSample(9, { ...base, transportBufferedMs: 40, transportRttMs: 3, transportConcealed: 30 }, { ...base, transportConcealed: 18 }), /made up \+12 \|/);

recordCallSample(base);
assert.equal(callTimeline().length, 0, "nothing is kept outside a call");

startCallTimeline();
for (let i = 0; i < 400; i++) recordCallSample(base);
const lines = callTimeline();
assert.equal(lines.length, 300, "capped");
assert.match(lines[0], /^call started /, "the start line survives the cap");
endCallTimeline();
assert.match(callTimeline().at(-1) ?? "", /^call ended after /);

// The next call keeps the end of this one, since people tend to report after rejoining.
startCallTimeline();
recordCallSample(base);
const both = callTimeline();
assert.equal(both.filter((l) => l.startsWith("call started")).length, 2, "the previous call is gone");
assert.ok(both.some((l) => l.startsWith("call ended after")), "the previous call's end is gone");
assert.equal(both.length, 120 + 2, "the previous call is kept to its last 120 lines");

console.log("call timeline: ok");
