/**
 * What a plugin says it wants to do, and what somebody has agreed to (GRYT-928).
 *
 * ## Read this before treating it as a sandbox, because it is not one
 *
 * A plugin is loaded with `<script type="module">` into the app's own page —
 * see `useAddonLoader`. It shares `window`, the DOM, `localStorage` and every
 * module the app has already imported. Nothing here can stop a plugin that
 * wants to go around it, and pretending otherwise would be worse than pretending
 * nothing: somebody would read "this addon may only set your status" as a
 * guarantee rather than as a claim.
 *
 * So this is **disclosure, not enforcement**. What it buys, honestly:
 *
 * - A plugin states what it needs, in its manifest, before it is enabled.
 * - The person sees that list and agrees to it, per addon.
 * - The polite path — `window.gryt` — refuses what was not agreed to, so a
 *   plugin that respects the contract is easy to write and a plugin that does
 *   not has to visibly go around it, which is the difference between an
 *   accident and a decision.
 *
 * Real isolation means running plugins somewhere they cannot reach the app —
 * a worker or an iframe with a message port. That is a different piece of work
 * and it is filed as one. Until it exists, installing a plugin is trusting
 * whoever wrote it, and the addons screen should keep saying so.
 */

/** Everything a plugin can ask for. Adding one means adding it here first. */
export const ADDON_CAPABILITIES = ["status"] as const;

export type AddonCapability = (typeof ADDON_CAPABILITIES)[number];

/** What each one lets a plugin do, in the words somebody agreeing to it reads. */
export const CAPABILITY_LABELS: Record<AddonCapability, string> = {
  status: "Set what you are doing, on every server you are on",
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
