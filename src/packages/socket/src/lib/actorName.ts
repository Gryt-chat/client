/**
 * Who did this, in words. The server writes `plugin:<id>` when no member acted;
 * left alone the "by …" clause goes missing, which reads as nobody (GRYT-938).
 */

const PLUGIN_PREFIX = "plugin:";

export type Actor =
  | { kind: "member"; label: string }
  | { kind: "plugin"; label: string; pluginId: string }
  /**
   * Nobody is named. The server does some things itself and writes no actor;
   * "the server" is the honest reading, and an empty space reads as a bug.
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
       would print "the  plugin", which looks like a rendering bug. */
    if (!pluginId) return { kind: "server", label: "the server" };
    return { kind: "plugin", label: `the ${pluginId} plugin`, pluginId };
  }

  /*
   * A nickname wins over an id, and a member with neither is still named as one.
   * Only an actor the server left empty is the server.
   */
  const name = typeof nickname === "string" ? nickname.trim() : "";
  if (name) return { kind: "member", label: name };
  if (id) return { kind: "member", label: id };

  return { kind: "server", label: "the server" };
}
