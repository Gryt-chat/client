/**
 * What a plugin says it wants to do, and what somebody has agreed to. A granted
 * capability bounds what a plugin can read, not where it sends what it was given.
 */

/** Everything a plugin can ask for. Adding one means adding it here first. */
export const ADDON_CAPABILITIES = ["status", "messaging", "display", "processes"] as const;

export type AddonCapability = (typeof ADDON_CAPABILITIES)[number];

/** What each one lets a plugin do, in the words somebody agreeing to it reads. */
export const CAPABILITY_LABELS: Record<AddonCapability, string> = {
  status: "Set what you are doing, on every server you are on",
  /*
   * Worded around what it costs rather than what it enables: what comes back was
   * sent by whoever runs the server, so agreeing involves them too (GRYT-939).
   */
  messaging: "Exchange its own messages with the servers you are on",
  /*
   * Worded around the room it takes rather than what it draws. It is space in the
   * app with somebody else's words in it, on every server (GRYT-951).
   */
  display: "Show its own panel beside the member list",
  /*
   * Worded as the list rather than the machine. A plugin is told which of the
   * programs *you listed* are running, and nothing else you have open (GRYT-931).
   */
  processes: "See which of your listed programs are running",
};

function isCapability(value: unknown): value is AddonCapability {
  return (
    typeof value === "string" &&
    (ADDON_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * The capabilities a manifest asks for, ignoring anything unrecognised, so a
 * manifest written against a newer Gryt still loads. Deduplicated and ordered.
 */
export function declaredCapabilities(value: unknown): AddonCapability[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<AddonCapability>();
  for (const entry of value) {
    if (isCapability(entry)) seen.add(entry);
  }
  return ADDON_CAPABILITIES.filter((c) => seen.has(c));
}

const GRANT_PREFIX = "addons.capabilities.";

/**
 * What somebody has agreed this addon may do. Stored per addon, so a grant cannot
 * silently apply to whatever takes that id next.
 */
export function grantedCapabilities(addonId: string): AddonCapability[] {
  try {
    const raw = localStorage.getItem(GRANT_PREFIX + addonId);
    return raw ? declaredCapabilities(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/**
 * Forget the grants of addons that are no longer installed. **Only ever called
 * with a list that is loaded** — pruning against an empty one wipes every grant.
 */
export function pruneGrants(installedIds: readonly string[]): void {
  if (installedIds.length === 0) return;

  const installed = new Set(installedIds);
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(GRANT_PREFIX)) continue;
      if (!installed.has(key.slice(GRANT_PREFIX.length))) stale.push(key);
    }
    // Collected first, because removing while iterating by index skips entries.
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    /* A device that will not let us read the keys keeps the stale ones, which
       is the same place we were before this existed. */
  }
}

export function setGrantedCapabilities(
  addonId: string,
  capabilities: AddonCapability[],
): void {
  try {
    localStorage.setItem(
      GRANT_PREFIX + addonId,
      JSON.stringify(declaredCapabilities(capabilities)),
    );
  } catch {
    /* A device that cannot store it grants nothing next time, which is the
       safe direction to fail in. */
  }
}

/**
 * Whether this addon may do this, right now. **Both halves matter**: a grant kept
 * after the manifest drops the capability is a permission nobody agreed to.
 */
export function addonMay(
  addonId: string,
  capability: AddonCapability,
  declared: readonly AddonCapability[],
): boolean {
  if (!declared.includes(capability)) return false;
  return grantedCapabilities(addonId).includes(capability);
}
