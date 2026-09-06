/* eslint-env node */

/**
 * Who a ban or an audit row says did it (GRYT-938).
 *
 * The server writes `plugin:<id>` when a plugin acted, because there is no
 * member to name and naming one would be a lie. That only helps if the client
 * says it — and the failure it replaces was silent: a plugin's ban rendered
 * with the "by …" clause missing altogether, which reads as nobody having done
 * it.
 *
 * Run against the real module rather than a copy — Node strips the types on
 * import, which is why this lives in .mjs and the source stays .ts.
 */

import assert from "node:assert/strict";

const { describeActor } = await import("../src/packages/socket/src/lib/actorName.ts");

/* ── a person ────────────────────────────────────────────────────────────── */

assert.deepEqual(describeActor("user_abc", "Sivert"), { kind: "member", label: "Sivert" });

/* A member the server could not name is still a member. Their id is who they
   are, and printing it beats pretending nobody acted. */
assert.deepEqual(describeActor("user_abc", null), { kind: "member", label: "user_abc" });
assert.deepEqual(describeActor("user_abc", "   "), { kind: "member", label: "user_abc" });

/* ── a plugin ────────────────────────────────────────────────────────────── */

assert.deepEqual(describeActor("plugin:automod"), {
  kind: "plugin",
  label: "the automod plugin",
  pluginId: "automod",
});

/* The nickname is ignored rather than preferred. A plugin id never joins
   against `users`, so a name arriving alongside one is either a coincidence or
   somebody's attempt to have a plugin's action read as a person's. */
assert.deepEqual(
  describeActor("plugin:automod", "Sivert"),
  { kind: "plugin", label: "the automod plugin", pluginId: "automod" },
  "a nickname alongside a plugin actor was allowed to win",
);

assert.equal(describeActor("plugin:my-watchdog").label, "the my-watchdog plugin");

/* ── nobody ──────────────────────────────────────────────────────────────── */

for (const empty of [null, undefined, "", "   "]) {
  assert.deepEqual(
    describeActor(empty),
    { kind: "server", label: "the server" },
    `expected the server for ${JSON.stringify(empty)}`,
  );
}

/* A bare prefix is not a plugin anybody can name. Reading it as one prints
   "the  plugin", which looks like a rendering bug rather than like data that
   should never have been written. */
assert.deepEqual(describeActor("plugin:"), { kind: "server", label: "the server" });
assert.deepEqual(describeActor("plugin:   "), { kind: "server", label: "the server" });

/* ── not a plugin, whatever it looks like ────────────────────────────────── */

/* The prefix is only a prefix. A member whose id merely contains it is a
   member, or somebody could pick a nickname that made their bans read as a
   plugin's. */
assert.equal(describeActor("user_plugin:automod", null).kind, "member");
assert.equal(describeActor("aplugin:automod", null).kind, "member");

/* Whitespace around the whole thing is the server's formatting, not a
   different actor. */
assert.deepEqual(describeActor("  plugin:automod  ").kind, "plugin");

console.log("check-actor-name: ok");
