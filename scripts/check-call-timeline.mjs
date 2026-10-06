/* eslint-env node */

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

recordCallSample(base);
assert.equal(callTimeline().length, 0, "nothing is kept outside a call");

startCallTimeline();
for (let i = 0; i < 400; i++) recordCallSample(base);
const lines = callTimeline();
assert.equal(lines.length, 300, "capped");
assert.match(lines[0], /^call started /, "the start line survives the cap");
endCallTimeline();
assert.match(callTimeline().at(-1), /^call ended after /);

console.log("call timeline: ok");
