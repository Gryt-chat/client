// The main identity (2026-10-21): this device's profile follows the first server in the sidebar, and only what differs changes.

import assert from "node:assert/strict";

import { mainIdentityChanges } from "../src/lib/mainIdentity.ts";

const local = { nickname: "Sivert", worn: null, mirroredAvatar: "a.chat:f1" };
const first = { host: "a.chat", nickname: "Sivert", avatarFileId: "f1", avatarWorn: null };

assert.deepEqual(mainIdentityChanges(first, local), {}, "a device already in step changed something");
assert.deepEqual(mainIdentityChanges(null, local), {}, "no servers changed something");
assert.deepEqual(mainIdentityChanges({ ...first, nickname: "Siv" }, local), { nickname: "Siv" });
assert.deepEqual(mainIdentityChanges({ ...first, nickname: "" }, local), {}, "a server with no name blanked the local one");
assert.deepEqual(mainIdentityChanges({ ...first, avatarFileId: "f2" }, local), { avatar: "a.chat:f2" });
assert.deepEqual(mainIdentityChanges({ ...first, host: "b.chat" }, local), { avatar: "b.chat:f1" }, "a new first server's picture wasn't taken");
assert.deepEqual(mainIdentityChanges({ ...first, avatarFileId: "f2", avatarVideo: true }, local), {}, "a video avatar was copied in as a picture");
assert.deepEqual(mainIdentityChanges({ ...first, avatarWorn: "owl:3" }, local), { worn: "owl:3" });
assert.deepEqual(mainIdentityChanges({ ...first, avatarWorn: undefined }, { ...local, worn: "owl:3" }), {}, "a server too old to say cleared the look");

console.log("main identity: follows the first server's name, picture and look, and leaves alone what already matches");
