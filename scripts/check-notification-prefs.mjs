/* eslint-env node */

/**
 * Which scope wins, and what a corrupt file falls back to. Most specific first,
 * and everything unrecognised falls back to hearing more rather than less.
 */

import assert from "node:assert/strict";

const {
  globalOverrules,
  parsePrefs,
  parseStored,
  quieterOf,
  resolveLevel,
  shouldAnnounceMention,
  shouldAnnounceMessage,
} = await import("../src/packages/common/src/hooks/notificationPrefs.ts");

const HOST = "gryt.test:5001";
const inFolder = { channelId: "c1", parentItemId: "f1" };
const loose = { channelId: "c2", parentItemId: null };

// ── Which scope wins ────────────────────────────────────────────────────────

// Nothing set anywhere: hear everything.
assert.equal(resolveLevel({}, HOST, inFolder), "all");
assert.equal(resolveLevel({ [HOST]: {} }, HOST, loose), "all");

// The server, when nothing more specific has an opinion.
assert.equal(
  resolveLevel({ [HOST]: { server: "mentions" } }, HOST, loose),
  "mentions",
);

// The folder beats the server.
assert.equal(
  resolveLevel({ [HOST]: { server: "none", folders: { f1: "all" } } }, HOST, inFolder),
  "all",
);

// The channel beats the folder.
assert.equal(
  resolveLevel(
    { [HOST]: { server: "none", folders: { f1: "none" }, channels: { c1: "all" } } },
    HOST,
    inFolder,
  ),
  "all",
);

/*
 * Muting the server does not overrule a channel that was set on purpose — the
 * one somebody would notice, having turned that channel up first.
 */
assert.equal(
  resolveLevel({ [HOST]: { server: "none", channels: { c2: "all" } } }, HOST, loose),
  "all",
);

// A channel in no folder skips the folder step rather than matching some
// folder that happens to share an id with nothing.
assert.equal(
  resolveLevel({ [HOST]: { folders: { f1: "none" } } }, HOST, loose),
  "all",
);

// Another server's settings are not this server's.
assert.equal(
  resolveLevel({ "other.test": { server: "none" } }, HOST, loose),
  "all",
);

// No placement at all still answers the server level, which is what a message
// from a channel this client has not seen the sidebar for looks like.
assert.equal(resolveLevel({ [HOST]: { server: "none" } }, HOST, null), "none");

// ── What each level lets through ────────────────────────────────────────────

assert.equal(shouldAnnounceMessage("all"), true);
assert.equal(shouldAnnounceMessage("mentions"), false);
assert.equal(shouldAnnounceMessage("none"), false);

assert.equal(shouldAnnounceMention("all"), true);
assert.equal(shouldAnnounceMention("mentions"), true);
assert.equal(shouldAnnounceMention("none"), false);

// ── Reading a file that has been got at ─────────────────────────────────────

assert.deepEqual(parsePrefs(null), {});
assert.deepEqual(parsePrefs("nonsense"), {});
assert.deepEqual(parsePrefs([1, 2, 3]), {});

// An unrecognised level is dropped rather than kept and treated as silence.
assert.deepEqual(parsePrefs({ [HOST]: { server: "quiet" } }), {});
assert.deepEqual(
  parsePrefs({ [HOST]: { channels: { c1: "loud", c2: "none" } } }),
  { [HOST]: { channels: { c2: "none" } } },
);

// A host whose every setting was junk is dropped entirely, rather than left as
// an empty object that later code has to keep checking.
assert.deepEqual(parsePrefs({ [HOST]: { folders: { f1: 7 } } }), {});

// A good file survives intact.
const good = { [HOST]: { server: "mentions", folders: { f1: "none" }, channels: { c1: "all" } } };
assert.deepEqual(parsePrefs(good), good);

// ── The global ceiling ──────────────────────────────────────────────────────
//
// It only ever quietens: a global of "everything" must not un-mute a server
// somebody muted on purpose.

assert.equal(quieterOf("all", "mentions"), "mentions");
assert.equal(quieterOf("mentions", "all"), "mentions");
assert.equal(quieterOf("mentions", "none"), "none");
assert.equal(quieterOf("none", "all"), "none");
assert.equal(quieterOf("all", "all"), "all");

// A global of "everything" leaves every server exactly where it was.
assert.equal(quieterOf("all", "none"), "none");
assert.equal(quieterOf("all", "mentions"), "mentions");

// The menus say so only where the global is the one deciding.
assert.equal(globalOverrules("mentions", "all"), true);
assert.equal(globalOverrules("none", "mentions"), true);
assert.equal(globalOverrules("mentions", "mentions"), false);
assert.equal(globalOverrules("mentions", "none"), false);
assert.equal(globalOverrules("all", "all"), false);

// ── Reading either shape of the file ────────────────────────────────────────

// The shape it is written in now.
assert.deepEqual(
  parseStored({ global: "mentions", servers: { [HOST]: { server: "none" } } }),
  { global: "mentions", servers: { [HOST]: { server: "none" } } },
);

// The shape it used to be written in: the servers map alone, no global. Reading
// one as an empty file would silently un-mute everything.
assert.deepEqual(parseStored({ [HOST]: { server: "none" } }), {
  global: "all",
  servers: { [HOST]: { server: "none" } },
});

// A global that is not a level falls back to hearing everything, like the rest
// of this file does.
assert.deepEqual(parseStored({ global: "quiet", servers: {} }), {
  global: "all",
  servers: {},
});

assert.deepEqual(parseStored(null), { global: "all", servers: {} });
assert.deepEqual(parseStored("nonsense"), { global: "all", servers: {} });
assert.deepEqual(parseStored([1, 2, 3]), { global: "all", servers: {} });

console.log("notification prefs: ok");
