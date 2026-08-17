import { listGuestScopes } from "./guest-history";

/**
 * Whether an account may take over the guest membership this device holds on a
 * particular server (GRYT-285).
 *
 * Replaces the single device-wide answer this used to be. The old question was
 * "is this device yours?", asked once after signing in, and a yes authorised
 * every guest identity on the machine at once — including servers joined
 * afterwards, which nobody had been asked about at all.
 *
 * Per server, because the decision genuinely differs per server. Somebody may
 * want their own community carried into their account and a server they were a
 * guest on once left exactly as it is. A single answer cannot say that, and the
 * one it does give is applied to servers the person had not thought about when
 * they gave it.
 *
 * ## Unanswered means no
 *
 * The proof is only signed once somebody has said yes. That is not caution for
 * its own sake: signing it tells the server the account and the guest are the
 * same person, and no later decision can take that back. An unanswered server
 * is one nobody has agreed to link, so nothing is sent.
 *
 * ## Filed by scope
 *
 * The same strings the keys and the guest history use — the server's lineage
 * where one is known, the address where it is not. A server that changes
 * address keeps the answer it was given (GRYT-257).
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
 * Carry the old device-wide answer across, once.
 *
 * Somebody who already answered "bring my servers with you" has agreed about
 * the servers they had at the time, and that agreement still stands for those.
 * It is applied to the scopes in the guest history, which is exactly the set
 * the old prompt was describing when it said "you joined N servers on this
 * device".
 *
 * A previous "no" carries across the same way, so nobody who declined is asked
 * again about the servers they declined for.
 *
 * What deliberately does not carry is the *open-ended* half of the old answer.
 * A yes given last month said nothing about a server joined tomorrow, and under
 * the old key it silently authorised it anyway. Those come through as
 * unanswered and get asked about on their own terms.
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

  // The old key is copied, not removed. `carryDeviceSettingsOver` in
  // userStorage.ts still reads it, and that one is asking a genuinely
  // device-wide question — whether this machine is yours, so its settings and
  // server list may move onto the account. That is not the same question as
  // whether a particular membership may be claimed, and folding it into
  // per-server answers would be answering it by accident. It gets its own slice.
  console.log(
    `[Identity] Migrated the device-wide merge choice (${legacy}) to ${
      changed ? "the servers it covered" : "nothing, since none were known"
    }`,
  );
}
