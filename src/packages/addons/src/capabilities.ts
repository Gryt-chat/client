/**
 * What a plugin says it wants to do, and what somebody has agreed to
 * (GRYT-928, GRYT-930).
 *
 * ## This is a boundary now, which it was not
 *
 * A plugin used to be a `<script type="module">` on the app's own page. It
 * shared `window`, the DOM, `localStorage` and every module the app had already
 * imported — the sockets, the message store, the identity keypair — so a plugin
 * that did not want to ask simply did not call `window.gryt`. This file opened
 * by saying so at length, because a list that reads as a guarantee and is only a
 * claim is worse than no list.
 *
 * A plugin runs in a worker now (`pluginHost.ts`, `addonWorker.ts`). The API is
 * a message protocol, every message is checked against this before it is
 * served, and there is no second route to what was refused: no `window`, no
 * DOM, no `localStorage`, no `indexedDB`, and no way to start a worker that
 * would have them.
 *
 * ## What it still does not cover
 *
 * A plugin keeps the network, on purpose — one that cannot reach Spotify is not
 * a now-playing plugin. So a granted capability is a boundary on what a plugin
 * can *read*, and not on where it can send what it was given. Somebody who
 * grants `messages:read` to a plugin is trusting it with those messages
 * wherever it decides to put them, and nothing here changes that.
 *
 * The manifest and the grant are still both checked, and both still have to say
 * yes: an addon that drops a capability in an update must not keep the
 * agreement somebody made when it had one.
 */

/** Everything a plugin can ask for. Adding one means adding it here first. */
export const ADDON_CAPABILITIES = ["status", "messaging"] as const;

export type AddonCapability = (typeof ADDON_CAPABILITIES)[number];

/** What each one lets a plugin do, in the words somebody agreeing to it reads. */
export const CAPABILITY_LABELS: Record<AddonCapability, string> = {
  status: "Set what you are doing, on every server you are on",
  /*
   * Worded around what it costs rather than what it enables (GRYT-939). What a
   * plugin sends reaches a server this person joined, and what comes back was
   * sent by whoever runs it — so this is the one capability where agreeing to
   * it involves somebody else's server as well as this plugin.
   */
  messaging: "Exchange its own messages with the servers you are on",
};

function isCapability(value: unknown): value is AddonCapability {
  return (
    typeof value === "string" &&
    (ADDON_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * The capabilities a manifest asks for, ignoring anything unrecognised.
 *
 * Unknown names are dropped rather than refused: a manifest written against a
 * newer Gryt should still load here and simply not get the part this build has
 * never heard of. The alternative is an addon that stops working entirely on an
 * older client, which is a worse failure for the person running it.
 *
 * Deduplicated and ordered, so two manifests asking for the same things produce
 * the same string and a grant cannot be defeated by reordering the list.
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
 * What somebody has agreed this addon may do.
 *
 * Stored per addon rather than as one list, so a grant cannot outlive the
 * addon it was made for: remove the addon and the key is orphaned rather than
 * silently applying to whatever takes its id next.
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
 * Forget the grants of addons that are no longer installed.
 *
 * Without this a grant outlives the addon it was made for, sitting in storage
 * keyed on an id. Ids come from a folder name, so the next addon to call itself
 * `nowplaying` would inherit permission somebody gave a different piece of
 * software — which is the exact thing the switches exist to prevent.
 *
 * **Only ever called with a list that is actually loaded.** The installed set
 * is empty for a moment at startup and while it is being read, and pruning
 * against that would wipe every grant on the device. An empty list is treated
 * as "not known yet" rather than as "nothing installed", so the one case this
 * cannot clean up is a person removing their last addon — which costs one
 * orphaned key and no permission anybody would notice.
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
 * Whether this addon may do this, right now.
 *
 * **Both halves matter.** A capability that is granted but no longer declared
 * is not allowed: an addon that quietly drops `status` from its manifest in an
 * update, and keeps the grant somebody made when it was there, would be using
 * a permission nobody agreed to for the version they are running.
 */
export function addonMay(
  addonId: string,
  capability: AddonCapability,
  declared: readonly AddonCapability[],
): boolean {
  if (!declared.includes(capability)) return false;
  return grantedCapabilities(addonId).includes(capability);
}
