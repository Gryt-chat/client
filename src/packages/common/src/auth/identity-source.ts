/**
 * Which identity this device joined each server with. Its own module to break a
 * cycle between the two that hold the signing keys. In memory only, per host.
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
