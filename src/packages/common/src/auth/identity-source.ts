/**
 * Which identity this device joined each server with (GRYT-727).
 *
 * Its own module, and that is not tidiness. It started in `answer-challenge.ts`,
 * which is where the choice is made — and then `identity-keys.ts` needed to read
 * it for GRYT-730, while `answer-challenge.ts` already imports from
 * `identity-keys.ts`. A cycle between the two modules that hold the signing keys
 * is not something to leave for somebody to trip over later.
 *
 * Recorded rather than worked out again. The choice turns on whether a Keycloak
 * token could be read at that moment, and asking a second time can answer
 * differently — a session since lapsed, a sign-in since made. A binding signed
 * with the other key still verifies and still pins; it just stops being a
 * statement about the key this server actually challenged.
 *
 * In memory only, and per host. Lost on reload, which is right: after a reload
 * nothing has joined anything yet, and the next join records it again.
 */

import type { IdentitySource } from "./identity-keys";

const byHost = new Map<string, IdentitySource>();

export function rememberIdentitySource(host: string, source: IdentitySource): void {
  byHost.set(host, source);
}

/** Null before this device has answered a challenge for that server. */
export function identitySourceUsedFor(host: string): IdentitySource | null {
  return byHost.get(host) ?? null;
}
