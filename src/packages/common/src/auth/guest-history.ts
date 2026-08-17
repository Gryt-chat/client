/**
 * Which servers this device has been a guest on (GRYT-285).
 *
 * Not a secret, and deliberately not stored with the secrets. The seed in
 * IndexedDB reproduces every guest key that has ever existed; this is the
 * separate question of which of those keys was ever actually used somewhere,
 * which derivation cannot answer — it will happily produce a key for a server
 * nobody has visited.
 *
 * That question used to be answered by the presence of a stored `local:*`
 * keypair, which is why those keypairs were written down at all. Keeping a
 * private key on disk to record a fact about where you have been is the wrong
 * trade, so the fact is recorded here and the keys can stop being persisted.
 *
 * ## Why it matters that this is local
 *
 * The alternative is asking the server, and the server cannot be asked without
 * telling it the answer. Proving a prior guest identity means signing a link
 * with that guest key, and the moment that proof arrives the server knows the
 * account and the guest are the same person. If the reply is "yes, there is
 * something to claim" and the person then says no thanks, the linkage has
 * already happened and cannot be taken back.
 *
 * Per-server unlinkability is the property the whole guest design exists to
 * protect, so the question of whether to prove anything has to be answerable
 * without proving anything. Knowing locally is what makes that possible: the
 * person is asked first, and the proof is signed only after they agree.
 *
 * ## What it stores
 *
 * Scopes, the same strings the keys were filed under — the server's lineage
 * where one is known, the address where it is not. Not addresses: a server that
 * moves is still the same server, which is the whole point of GRYT-257.
 *
 * Nothing here identifies a person. It is a list of servers this browser
 * profile has talked to, which is also plainly visible from the server list.
 */

const STORAGE_KEY = "gryt_guest_history";

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((s): s is string => typeof s === "string"));
  } catch {
    // Unreadable or unparseable is the same as empty. The cost of being wrong
    // is that somebody is not offered a claim they could have made, and they
    // can still ask for it by hand.
    return new Set();
  }
}

function write(scopes: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...scopes]));
  } catch {
    // Private mode, quota, a disabled store. Losing the record costs the
    // automatic offer and nothing else.
  }
}

/** Note that this device has been a guest under `scope`. Idempotent. */
export function rememberGuestScope(scope: string): void {
  const scopes = read();
  if (scopes.has(scope)) return;
  scopes.add(scope);
  write(scopes);
}

/** Whether this device has ever been a guest under `scope`. */
export function hasGuestScope(scope: string): boolean {
  return read().has(scope);
}

/** Every scope this device has been a guest under. */
export function listGuestScopes(): string[] {
  return [...read()];
}

/** Drop one, for a server being left. */
export function forgetGuestScope(scope: string): void {
  const scopes = read();
  if (!scopes.delete(scope)) return;
  write(scopes);
}

/**
 * Take in scopes from somewhere that already knows them.
 *
 * Two callers. The backfill in `identity-keys.ts` reads the `local:*` entries
 * an existing install already has, so nobody who upgrades loses the offer to
 * carry an identity over. And restoring a backup file adds the scopes it lists,
 * since a file naming six servers is evidence of having been on six servers.
 *
 * A restored 24-word phrase brings nothing, because a phrase is a seed and a
 * seed knows nothing about where it has been. That case is why the claim has to
 * be reachable by hand as well as offered automatically.
 */
export function rememberGuestScopes(scopes: Iterable<string>): void {
  const known = read();
  let added = false;
  for (const scope of scopes) {
    if (!scope || known.has(scope)) continue;
    known.add(scope);
    added = true;
  }
  if (added) write(known);
}
