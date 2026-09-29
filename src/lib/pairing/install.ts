import type { PairingStorage, PairingTokens } from "@gryt/core";
import type { IdentityBackupEntry, PairingAccount, PairingEnvelope, PairingPin, PairingServer, PeerPin, PeerPinStore } from "@gryt/crypto";

/* What the new device keeps once linking has checked out (GRYT-1484). Core calls `commit`
   once, after the emoji, the envelope and any sign-in have all passed. */

export interface LinkInstallDeps {
  /** Writes the seed and the stored keys, dropping this device's old local keys. */
  installIdentity(seed: Uint8Array, keys: IdentityBackupEntry[]): Promise<void>;
  /** The server lineage to pin under when this device first meets `host`. */
  expectLineage(host: string, originKeyId: string): void;
  pinStore: PeerPinStore;
  markSeenOnMls(scope: string, memberId: string): void;
  /** Adds the servers to the list the account (or this guest) will load. */
  writeServers(servers: PairingServer[], account: PairingAccount | undefined): Promise<void>;
  /** The auth server this device signs in with, when the other device uses a different one. */
  currentIssuer(): string;
  useAuthServer(issuer: string, identityUrl: string): void;
  adoptSession(tokens: PairingTokens): Promise<void>;
  /** Stops the "enter your message password" prompt: this device has the account's seed now. */
  rememberMessageKey(sub: string): void;
  forgetMlsDevices(): void;
}

const SERVER_SCOPE = "srv:";
const pinKey = (scope: string, memberId: string) => `${scope} ${memberId}`;
const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** The other device's pins, without replacing any this device already made for itself. */
export function mergePeerPins(
  existing: Record<string, PeerPin>,
  incoming: Record<string, Record<string, PairingPin>>,
): { pins: Record<string, PeerPin>; seen: { scope: string; memberId: string }[] } {
  const pins = { ...existing };
  const seen: { scope: string; memberId: string }[] = [];
  for (const [scope, members] of Object.entries(incoming)) {
    for (const [memberId, { seenOnMls, ...pin }] of Object.entries(members)) {
      if (seenOnMls) seen.push({ scope, memberId });
      const key = pinKey(scope, memberId);
      if (!pins[key]) pins[key] = pin;
    }
  }
  return { pins, seen };
}

/** Hosts whose scope names a server lineage, with that lineage. */
export function lineageHints(servers: PairingServer[]): { host: string; originKeyId: string }[] {
  return servers
    .filter((s) => s.scope.startsWith(SERVER_SCOPE) && s.scope.length > SERVER_SCOPE.length)
    .map((s) => ({ host: s.host, originKeyId: s.scope.slice(SERVER_SCOPE.length) }));
}

export function createLinkStorage(deps: LinkInstallDeps): PairingStorage {
  return {
    async commit(envelope: PairingEnvelope, tokens: PairingTokens | null) {
      deps.forgetMlsDevices();

      // Pins and lineages before the identity, so nothing derives under a scope it guessed.
      const { pins, seen } = mergePeerPins(deps.pinStore.read(), envelope.pins);
      deps.pinStore.write(pins);
      for (const { scope, memberId } of seen) deps.markSeenOnMls(scope, memberId);
      for (const { host, originKeyId } of lineageHints(envelope.servers)) deps.expectLineage(host, originKeyId);

      await deps.installIdentity(envelope.seed, envelope.keys);

      const { account } = envelope;
      if (account && !sameUrl(account.issuer, deps.currentIssuer())) {
        deps.useAuthServer(account.issuer, account.identityUrl);
      }
      // Written under the account before signing in, so the first load as the account finds them.
      await deps.writeServers(envelope.servers, account);
      if (account) {
        if (!tokens) throw new Error("An account came with no sign-in.");
        await deps.adoptSession(tokens);
        deps.rememberMessageKey(account.sub);
      }
    },
  };
}
