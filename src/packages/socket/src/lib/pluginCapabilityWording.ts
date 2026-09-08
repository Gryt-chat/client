/**
 * What a server plugin's capability means, in words. The wording is about the
 * person reading it: "reads every message you send", not "may read messages".
 */

const WORDING: Record<string, string> = {
  "messages:read": "Reads every message you send in a channel",
  "members:read": "Sees when you join or leave, and the invite you used",
  moderation: "Can kick you, ban you, and delete your messages",
  messaging: "Talks to a copy of itself in people's Gryt apps",
};

/**
 * A capability this build has never heard of. **Shown, not hidden** — dropping it
 * would mean the scarier the capability, the less likely it is to be seen.
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
 * What to say when a server names no plugins at all. Not "runs no plugins": a
 * server too old to answer sends the same nothing as one running nothing.
 */
export const NOTHING_NAMED = "This server has not named any plugins.";

/**
 * The plugins on this server whose other half you do not have. Nothing is
 * enforced; inferred from `messaging` rather than announced in a manifest.
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
