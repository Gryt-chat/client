// gryt-voice's line protocol (GRYT-1837): what the renderer reads from its reports, and what main lets reach its stdin.

import assert from "node:assert/strict";

import { allowedVoiceCommand, startLine } from "../electron/voiceHelperLines.ts";
import { effectValues, parseReport } from "../src/packages/webRTC/src/adapters/voiceHelperReport.ts";

const report = parseReport("r 0 -23.5 1 l=7:-12.3,9:-40.0 b=7:12.5,9:30.0 s=7");
assert.ok(report, "a report line didn't parse");
assert.equal(report.mic, -23.5);
assert.equal(report.micSpeaking, true);
assert.deepEqual([...report.levels], [[7, -12.3], [9, -40]]);
assert.deepEqual([...report.buffered], [[7, 12.5], [9, 30]]);
assert.deepEqual(report.speaking, [7]);
const quiet = parseReport("r -1 -120.0 0 l= b= s=");
assert.ok(quiet && quiet.levels.size === 0 && quiet.speaking.length === 0, "an empty report wasn't empty");
assert.equal(parseReport("started 1"), null);

// voice_helper.c reads them positionally, so the order is the contract.
assert.deepEqual(
  effectValues({ volume: 80, gateThreshold: -50, gateReleaseMs: 200, gateSmoothing: 0.8, autoGain: true, autoGainTargetDb: -20, compressor: false, compressorAmount: 50, limiter: true }),
  [80, -50, 200, 0.8, 1, -20, 0, 50, 1],
);

const offer = { addrs: ["1.2.3.4:10004"], session: 7, key: "a2V5", effects: [100, 0, 200, 0.8, 0, -20, 0, 50, 0] };
assert.equal(startLine(offer), "effects 100 0 200 0.8 0 -20 0 50 0\nstart 7 a2V5 64 1.2.3.4:10004\n");
assert.equal(startLine({ ...offer, key: "a b" }), null, "a space in the key would shift every field after it");
assert.equal(startLine({ ...offer, addrs: ["1.2.3.4:1\nstop"] }), null, "a newline in an address would add a command");
assert.equal(startLine({ ...offer, effects: [1, 2] }), null);
assert.equal(startLine({ ...offer, effects: [...offer.effects.slice(1), Number.NaN] }), null);

assert.ok(allowedVoiceCommand("sending 1") && allowedVoiceCommand("stop") && allowedVoiceCommand("gains 7=0.5"));
assert.ok(!allowedVoiceCommand("start 1 key 64 1.2.3.4:1"), "start goes through its own handler");
assert.ok(!allowedVoiceCommand("sending 1\nquit"), "a newline smuggled a second command");
assert.ok(!allowedVoiceCommand("quit") && !allowedVoiceCommand(42));

console.log("voice helper lines: reports parse, effects keep their order, and only one known command reaches its stdin at a time");
