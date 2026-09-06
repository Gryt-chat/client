/**
 * Who did this, in words (GRYT-938).
 *
 * Most things on a server are done by a member, and the server sends a
 * nickname for them. Some are done by a plugin, and there is no member to name
 * — the server writes `plugin:<id>` into the actor field on purpose, because
 * telling somebody a person did what a plugin did would be a lie in the one
 * field that exists to answer "who did this".
 *
 * The client then has to say that out loud. Left alone, a plugin's ban renders
 * with the "by …" clause missing entirely, which reads as *nobody* did it —
 * the opposite of what the honest actor id was for. And the audit log prints
 * the raw `plugin:automod`, which is correct and is not language.
 */

const PLUGIN_PREFIX = "plugin:";

export type Actor =
  | { kind: "member"; label: string }
  | { kind: "plugin"; label: string; pluginId: string }
  /**
   * Nobody is named. The server does some things itself — an expiry, a
   * migration — and writes no actor at all. "the server" is the honest reading
   * and is better than an empty space, which reads as a bug.
   */
  | { kind: "server"; label: string };

/**
 * @param actorId The raw actor id, as the server sends it.
 * @param nickname The name the server resolved for it, when it resolved one.
 */
export function describeActor(
  actorId: string | null | undefined,
  nickname?: string | null,
): Actor {
  const id = typeof actorId === "string" ? actorId.trim() : "";

  if (id.startsWith(PLUGIN_PREFIX)) {
    const pluginId = id.slice(PLUGIN_PREFIX.length).trim();
    /* A bare `plugin:` is not a plugin anybody can name. Reading it as one
       would print "the  plugin", which looks like a rendering bug rather than
       like data nobody should have written. */
    if (!pluginId) return { kind: "server", label: "the server" };
    return { kind: "plugin", label: `the ${pluginId} plugin`, pluginId };
  }

  /*
   * A nickname wins over an id, and a member with neither still gets named as
   * one — an id is who they are, and printing it is better than pretending
   * nobody acted. Only an actor the server left empty is the server.
   */
  const name = typeof nickname === "string" ? nickname.trim() : "";
  if (name) return { kind: "member", label: name };
  if (id) return { kind: "member", label: id };

  return { kind: "server", label: "the server" };
}
