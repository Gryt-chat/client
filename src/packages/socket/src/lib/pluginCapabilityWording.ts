/**
 * What a server plugin's capability means, in words (GRYT-942).
 *
 * A server names every plugin it runs and says what each is allowed to do — see
 * the server plugins docs. It says it in the server's own vocabulary:
 * `messages:read`, `moderation`. That vocabulary is the point of the list and
 * also useless to almost everybody reading it, so this turns it into a sentence.
 *
 * The wording is about the person reading it rather than about the plugin.
 * "Reads every message you send" and not "may read channel messages", because
 * the question somebody has when they open this is whether to keep typing here.
 */

const WORDING: Record<string, string> = {
  "messages:read": "Reads every message you send in a channel",
  "members:read": "Sees when you join or leave, and the invite you used",
  moderation: "Can kick you, ban you, and delete your messages",
  messaging: "Talks to a copy of itself in people's Gryt apps",
};

/**
 * A capability this build has never heard of.
 *
 * **Shown, not hidden.** A newer server is exactly where a capability worth
 * knowing about would arrive, and quietly dropping it would mean the scarier
 * the capability, the less likely somebody is to see it. The raw name is worse
 * than a sentence and far better than nothing, and saying it is unrecognised is
 * what stops it reading as Gryt's own wording.
 */
export function describeCapability(capability: string): string {
  const known = WORDING[capability];
  if (known) return known;
  return `${capability} — this Gryt is too old to say what that means`;
}

/** Every capability, in the order the server sent them. */
export function describeCapabilities(capabilities: readonly string[]): string[] {
  return capabilities
    .filter((c) => typeof c === "string" && c.trim() !== "")
    .map((c) => describeCapability(c.trim()));
}

/**
 * What to say when a server names no plugins at all.
 *
 * Deliberately not "this server runs no plugins". A server too old to answer
 * sends the same nothing as a server running nothing, and there is no way to
 * tell them apart from here — so the honest line says what is known, which is
 * that nothing was named.
 */
export const NOTHING_NAMED = "This server has not named any plugins.";

/**
 * The plugins on this server whose other half you do not have (GRYT-942).
 *
 * A server plugin declaring `messaging` has a client half by definition —
 * that capability is exactly "talks to a copy of itself in people's Gryt
 * apps". So a server naming one, with no addon of the same id installed here,
 * is a thing this person is missing.
 *
 * Nothing is enforced. A Minecraft server throws you out for missing a mod;
 * Gryt does not, because the messages and the voice are the server and a plugin
 * is what somebody added on top. Missing one means missing what it adds, and
 * that is worth being told rather than worth being refused for.
 *
 * Inferred rather than announced, deliberately. The alternative is a field in
 * the manifest saying "I have a client half", which is a second thing to keep
 * true and would be wrong the first time somebody forgot it.
 */
export function missingHalves<T extends { id: string; capabilities: readonly string[] }>(
  announced: readonly T[],
  installedAddonIds: readonly string[],
): T[] {
  const installed = new Set(installedAddonIds);
  return announced.filter(
    (plugin) => plugin.capabilities.includes("messaging") && !installed.has(plugin.id),
  );
}
