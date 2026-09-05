/* eslint-env node */

/**
 * Which scope wins, and what a corrupt file falls back to.
 *
 * Most specific first: a channel beats its folder, which beats the server. The
 * case that decides whether the whole thing is usable is the third one below —
 * muting a server has to leave a channel somebody has already had an opinion
 * about alone, or "mute this server" quietly overrules a decision that was made
 * more deliberately than it was.
 *
 * Everything unrecognised falls back to hearing more rather than less. Somebody
 * hearing too much notices and fixes it. Somebody hearing nothing cannot tell
 * that from a quiet day.
 */

import assert from "node:assert/strict";

const {
  parsePrefs,
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
 * Muting the server does not overrule a channel that was set on purpose. This
 * is the one somebody would notice: they turned one channel up, muted the
 * server on a busy afternoon, and the channel they cared about went quiet with
 * everything else.
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

console.log("notification prefs: ok");
