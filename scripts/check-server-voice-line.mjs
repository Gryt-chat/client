#!/usr/bin/env node
/** The server rail's hover card lists who is in voice, once each, never a DM call (GRYT-1657). */

import assert from "node:assert/strict";

import { inVoiceLine, voiceNicknames } from "../src/components/serverVoiceLine.ts";

assert.deepEqual(
  voiceNicknames({
    a: { serverUserId: "u1", nickname: "Ada", voiceChannelId: "voice-1" },
    b: { serverUserId: "u1", nickname: "Ada", voiceChannelId: "voice-1" },
    c: { serverUserId: "u2", nickname: "Bo", voiceChannelId: "voice-2" },
    d: { serverUserId: "u3", nickname: "Cy", voiceChannelId: "dm_abc" },
    e: { serverUserId: "u4", nickname: "Di" },
  }),
  ["Ada", "Bo"],
  "one entry per person, and calls in direct messages stay private",
);
assert.equal(inVoiceLine(["Ada", "Bo"]), "Ada, Bo");
assert.equal(inVoiceLine(["A", "B", "C", "D"]), "A, B, C, D");
assert.equal(inVoiceLine(["A", "B", "C", "D", "E", "F"]), "A, B, C and 3 more");
console.log("server voice line: ok");
