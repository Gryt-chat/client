// The "someone joined" and "someone left" sounds: who counts as being in your channel, and which sound a change plays.

import assert from "node:assert/strict";

const { peersInChannel, peerChange } = await import("../src/packages/webRTC/src/adapters/peersInChannel.ts");

const clients = {
  me: { hasJoinedChannel: true, voiceChannelId: "c1", serverUserId: "u-me" },
  a1: { hasJoinedChannel: true, voiceChannelId: "c1", serverUserId: "u-a" },
  a2: { hasJoinedChannel: true, voiceChannelId: "c1", serverUserId: "u-a" },
  b: { hasJoinedChannel: true, voiceChannelId: "c2", serverUserId: "u-b" },
  c: { hasJoinedChannel: false, voiceChannelId: "c1", serverUserId: "u-c" },
  d: { hasJoinedChannel: true, voiceChannelId: "c1" },
};
assert.deepEqual([...peersInChannel(clients, "c1", "me")].sort(), ["d", "u-a"], "wrong people counted as in the channel");

const s = (...ids: string[]) => new Set(ids);
assert.equal(peerChange(s("a"), s("a", "b")), "join");
assert.equal(peerChange(s("a", "b"), s("a")), "leave");
assert.equal(peerChange(s("a"), s("a")), null);
assert.equal(peerChange(s("a"), s("b")), "join", "a swap should sound like an arrival");
console.log("peer voice sounds: ok");
