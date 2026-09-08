import { listGuestScopes } from "./guest-history";

/**
 * Whether an account may take over the guest membership this device holds on one
 * server. **Unanswered means no**, and answers are filed by scope (GRYT-285).
 */

const CLAIMS_KEY = "gryt_identity_claims";

/** The device-wide answer this replaces. Read once, to migrate, then removed. */
const LEGACY_CHOICE_KEY = "gryt_merge_local_identities";

export type ClaimDecision = "yes" | "no";

type Claims = Record<string, ClaimDecision>;

function read(): Claims {
  try {
    const raw = localStorage.getItem(CLAIMS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Claims = {};
    for (const [scope, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === "yes" || value === "no") out[scope] = value;
    }
    return out;
  } catch {
    // Unreadable is the same as unanswered, which means nothing is proved to
    // anybody. Failing closed is the right direction for this particular value.
    return {};
  }
}

function write(claims: Claims): void {
  try {
    localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims));
  } catch {
    // The cost is being asked again, which is the safe way to be wrong.
  }
}

/** What was decided for this scope, or null if nobody has been asked. */
export function getClaimDecision(scope: string): ClaimDecision | null {
  return read()[scope] ?? null;
}

/** Whether the link proof may be signed for this scope. Only an explicit yes. */
export function mayClaim(scope: string): boolean {
  return getClaimDecision(scope) === "yes";
}

export function setClaimDecision(scope: string, decision: ClaimDecision): void {
  const claims = read();
  if (claims[scope] === decision) return;
  claims[scope] = decision;
  write(claims);
}

/**
 * Forgotten on sign-out, so the next account is asked for itself rather than
 * inheriting answers meant for a different one.
 */
export function clearClaimDecisions(): void {
  try {
    localStorage.removeItem(CLAIMS_KEY);
    localStorage.removeItem(LEGACY_CHOICE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Carry the old device-wide answer across, once, onto the scopes in the guest
 * history. **The open-ended half does not carry** — a yes said nothing about later.
 */
export function migrateLegacyMergeChoice(): void {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_CHOICE_KEY);
  } catch {
    return;
  }
  if (legacy !== "yes" && legacy !== "no") return;

  const claims = read();
  let changed = false;
  for (const scope of listGuestScopes()) {
    if (claims[scope]) continue;
    claims[scope] = legacy;
    changed = true;
  }
  if (changed) write(claims);

  // The old key is copied, not removed: `carryDeviceSettingsOver` still reads it,
  // and "is this machine yours" is not the same question as this one.
  console.log(
    `[Identity] Migrated the device-wide merge choice (${legacy}) to ${
      changed ? "the servers it covered" : "nothing, since none were known"
    }`,
  );
}
