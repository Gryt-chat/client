import type { IdentityBackupEntry, IdentityScope, PairingAccount, PairingEnvelope, PairingPin, PairingServer, PeerPin } from "@gryt/crypto";

/* What the approving device seals to the new one (GRYT-1484). Built from this device's own
   stores; crypto's encoder checks the shape again before anything is sent. */

export interface EnvelopeInput {
  seed: Uint8Array;
  keys: IdentityBackupEntry[];
  account?: PairingAccount;
  servers: { host: string; name: string; scope: IdentityScope; scheme?: "http" | "https" | null }[];
  /** The peer pin store as it's kept: `${scope} ${memberId}` to pin. */
  pins: Record<string, PeerPin>;
  seenOnMls(scope: string, memberId: string): boolean;
  from: string;
}

/** The token claims the account half needs, or null when they aren't all there. */
export function accountFromToken(
  claims: Record<string, unknown> | undefined,
  config: { clientId: string; identityUrl: string },
): PairingAccount | null {
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  const issuer = text(claims?.iss);
  const sub = text(claims?.sub);
  const username = text(claims?.preferred_username) ?? text(claims?.email);
  if (!issuer || !sub || !username) return null;
  return { issuer, clientId: config.clientId, identityUrl: config.identityUrl, sub, username };
}

export function buildEnvelope(input: EnvelopeInput): PairingEnvelope {
  const servers: PairingServer[] = input.servers.map(({ host, name, scope, scheme }) => ({
    host,
    name,
    scope,
    ...(scheme ? { scheme } : {}),
  }));

  // Only the servers being handed over, which keeps the envelope well under its 256 KiB cap.
  const scopes = new Set<string>(servers.map((s) => s.scope));
  const pins: Record<string, Record<string, PairingPin>> = {};
  for (const [key, pin] of Object.entries(input.pins)) {
    const split = key.indexOf(" ");
    if (split <= 0) continue;
    const scope = key.slice(0, split);
    const memberId = key.slice(split + 1);
    if (!scopes.has(scope) || !memberId) continue;
    pins[scope] ??= {};
    pins[scope][memberId] = input.seenOnMls(scope, memberId) ? { ...pin, seenOnMls: true } : { ...pin };
  }

  return {
    seed: input.seed,
    keys: input.keys,
    ...(input.account ? { account: input.account } : {}),
    servers,
    pins,
    from: input.from,
  };
}
