/** Tile ids for shared windows (GRYT-1905): the first keeps today's id, later ones are numbered. */
import assert from "node:assert/strict";

import { parseScreenItem, screenItemId, shareCount, shareOf } from "../src/packages/socket/src/lib/screenItems.ts";

assert.equal(screenItemId("sock-a", 0), "screen:sock-a");
assert.equal(screenItemId("sock-a", 2), "screen:sock-a#2");
assert.deepEqual(parseScreenItem("screen:sock-a"), { clientId: "sock-a", index: 0 });
assert.deepEqual(parseScreenItem("screen:sock-a#2"), { clientId: "sock-a", index: 2 });
assert.deepEqual(parseScreenItem("screen:sock-a#x"), { clientId: "sock-a#x", index: 0 });

const legacy = { screenShareEnabled: true, screenShareVideoStreamID: "v0", screenShareAudioStreamID: "a0" };
assert.equal(shareCount(legacy), 1, "a server without the list still shows one window");
assert.deepEqual(shareOf(legacy, 0), { videoStreamID: "v0", audioStreamID: "a0" });
assert.deepEqual(shareOf(legacy, 1), { videoStreamID: "", audioStreamID: "" });

const two = { ...legacy, screenShares: [{ videoStreamID: "v0", audioStreamID: "a0" }, { videoStreamID: "v1", audioStreamID: "" }] };
assert.equal(shareCount(two), 2);
assert.deepEqual(shareOf(two, 1), { videoStreamID: "v1", audioStreamID: "" });
assert.equal(shareCount({ ...two, screenShareEnabled: false }), 0);

console.log("screen items ok: the first window keeps its id, later ones are numbered, older servers show one");
