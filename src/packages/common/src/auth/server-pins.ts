/**
 * Trust-on-first-use pinning of server identity keys (GRYT-51).
 *
 * Nothing else authenticates a *server* to us. On the public deployment TLS
 * proves the endpoint; on a LAN there is no TLS and mDNS advertisements are
 * unauthenticated, so `server_id` is a discovery hint and never a credential.
 *
 * A server proves itself by signing a nonce we chose with a long-lived key we
 * pinned the first time we joined it. Pins are filed under the key, not under
 * host:port, so a server that moves — which GRYT-48 now makes it do on its own
 * when a port is taken — is still recognisably the same server.
 *
 * This module decides; it does not connect. The socket layer applies the
 * decision.
 */

const PINS_KEY = "serverIdentityPins";
const HOST_INDEX_KEY = "serverIdentityHostIndex";
const BLOCKLIST_KEY = "serverIdentityBlocklist";

const VERIFY_ALGO: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };
const IMPORT_ALGO: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };

export interface ServerPin {
  keyId: string;
  jwk: JsonWebKey;
  firstSeenAt: number;
  lastSeenAt: number;
  /** Most recent address this key answered on. Display only — never a key. */
  lastHost: string;
  /**
   * The key this server was *first* pinned under, carried across rotations.
   *
   * `keyId` is what the server signs with today and changes every time it
   * rotates. This does not, which is what makes it usable as a name for the
   * server itself rather than for its current key — see `identityScopeFor` in
   * `identity-keys.ts`, which files a guest identity under it.
   *
   * Optional because pins written before this existed do not have one. Absent
   * means "treat today's key as the origin": the lineage starts from whatever
   * is known now, which is the most that can be recovered.
   */
  originKeyId?: string;
}

export interface BlockedServer {
  /** The address the substitution happened on. Always known. */
  host: string;
  /**
   * The key that answered. Absent when the server withdrew its proof entirely,
   * which is a block against the address rather than against any key.
   */
  keyId?: string;
  /** Key we expected at this address. */
  expectedKeyId: string;
  blockedAt: number;
  reason: "key_mismatch" | "proof_withdrawn";
}

export type ServerProofFailure =
  | { reason: "malformed"; detail: string }
  | { reason: "bad_signature"; detail: string }
  | { reason: "nonce_mismatch"; detail: string }
  | {
      reason: "expired";
      detail: string;
      /**
       * How far the server's clock sits behind ours, in milliseconds, negative
       * if it is ahead. Absent when the proof carried no `iat` to compare.
       *
       * Measured from `iat` rather than `exp` because it is the one instant both
       * sides describe: the server says when it signed, and we know when we read
       * it. The gap is the skew plus the network round trip, and a round trip is
       * milliseconds against a window of a minute, so what survives is the skew.
       */
      skewMs?: number;
    }
  | { reason: "key_mismatch"; detail: string; expectedKeyId: string; presentedKeyId: string }
  | { reason: "proof_withdrawn"; detail: string; expectedKeyId: string }
  | { reason: "blocked"; detail: string; keyId: string };

export type ServerProofDecision =
  /** Known key, signature checked against the pin. */
  | { action: "trusted"; keyId: string; movedFrom?: string }
  /** Never seen this key. Pin it — the trust-on-first-use moment. */
  | { action: "pin"; keyId: string; jwk: JsonWebKey }
  /**
   * A different key, but the server proved the change was deliberate with a
   * statement signed by the key we had pinned (GRYT-54).
   */
  | {
      action: "rotated";
      keyId: string;
      jwk: JsonWebKey;
      previousKeyId: string;
      /** Keys stepped through, in order. More than one means we were behind. */
      hops: string[];
    }
  /** Server offered no proof and we have never had one from this address. */
  | { action: "unauthenticated" }
  /** Refuse the connection. */
  | { action: "block"; failure: ServerProofFailure };

// ── Storage ─────────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function listPins(): Record<string, ServerPin> {
  return readJson<Record<string, ServerPin>>(PINS_KEY, {});
}

export function getPin(keyId: string): ServerPin | null {
  return listPins()[keyId] ?? null;
}

/**
 * Which key we last saw at an address. A hint for spotting a *substitution* —
 * a different server answering where a known one used to. The pin itself is
 * filed under the key, so this index going stale costs recognition, not safety.
 */
function readHostIndex(): Record<string, string> {
  return readJson<Record<string, string>>(HOST_INDEX_KEY, {});
}

export function getExpectedKeyIdForHost(host: string): string | null {
  return readHostIndex()[host] ?? null;
}

/**
 * A name for the server at an address that survives both moving and rotating.
 *
 * The address changes when a port is taken (GRYT-48) or a home router hands out
 * a new lease; the key changes on rotation (GRYT-54). Neither is a different
 * server, so neither should look like one to anything filed per-server.
 *
 * Null when the server offered no proof, which is the one case where there is
 * nothing better than the address to go on.
 */
export function getOriginKeyIdForHost(host: string): string | null {
  const keyId = getExpectedKeyIdForHost(host);
  if (!keyId) return null;
  return listPins()[keyId]?.originKeyId ?? keyId;
}

/**
 * Every address we currently expect a key at. Read-only; the settings screen
 * uses it to tell an orphaned pin from one still in use at another address,
 * which matters because the same key legitimately answers at several.
 */
export function listHostExpectations(): Record<string, string> {
  return readHostIndex();
}

export function savePin(keyId: string, jwk: JsonWebKey, host: string): void {
  const pins = listPins();
  const now = Date.now();
  const existing = pins[keyId];

  pins[keyId] = {
    keyId,
    jwk,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    lastHost: host,
    originKeyId: existing?.originKeyId ?? existing?.keyId ?? keyId,
  };
  writeJson(PINS_KEY, pins);

  const index = readHostIndex();
  index[host] = keyId;
  writeJson(HOST_INDEX_KEY, index);
}

/**
 * Succeed one pinned key with another after a proven rotation (GRYT-54).
 *
 * Every address that expected the old key is moved to the new one, not just the
 * address we happen to be connected to. The same server legitimately answers at
 * several, and leaving the others pointing at a retired key would quietly
 * downgrade them to first-join on next contact — losing exactly the
 * substitution check this exists to provide.
 *
 * `firstSeenAt` carries over: it is when this *server* was first trusted, which
 * a key change does not reset.
 */
export function replacePin(
  oldKeyId: string,
  newKeyId: string,
  jwk: JsonWebKey,
  host: string,
): void {
  const pins = listPins();
  const previous = pins[oldKeyId];
  const now = Date.now();

  delete pins[oldKeyId];
  pins[newKeyId] = {
    keyId: newKeyId,
    jwk,
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
    lastHost: host,
    // Carries over for the same reason `firstSeenAt` does: a key change is not
    // a different server. Anything filed under the lineage — a guest identity,
    // and its roles and history with it — survives the rotation because of this
    // line.
    originKeyId: previous?.originKeyId ?? oldKeyId,
  };
  writeJson(PINS_KEY, pins);

  const index = readHostIndex();
  for (const [h, id] of Object.entries(index)) {
    if (id === oldKeyId) index[h] = newKeyId;
  }
  index[host] = newKeyId;
  writeJson(HOST_INDEX_KEY, index);
}

/** Forget a server entirely, so the next join pins afresh. */
export function forgetPin(keyId: string): void {
  const pins = listPins();
  delete pins[keyId];
  writeJson(PINS_KEY, pins);

  const index = readHostIndex();
  for (const [host, id] of Object.entries(index)) {
    if (id === keyId) delete index[host];
  }
  writeJson(HOST_INDEX_KEY, index);
}

/**
 * Forget everything this client knows about one address.
 *
 * What leaving a server should do. A pin protects an ongoing relationship: it
 * says "the server I am a member of answers with this key, and I want to know
 * if something else ever answers instead". Once you have left, there is no
 * relationship left to protect, and rejoining is the same fresh trust decision
 * you made the first time.
 *
 * Leaving used to drop the sidebar entry and nothing else, so the expectation
 * outlived the membership. Rebuild a server on the same address and the client
 * refused it, and the only way out was Settings → Server identities, which you
 * had to already know existed.
 *
 * Deliberately not `forgetPin`. That deletes the key and every address
 * expecting it, and the same key legitimately answers at several — a server
 * reachable on its LAN address and through a tunnel is one key and two hosts.
 * Leaving one of those must not un-pin the other. So the expectation for this
 * host goes, and the pin itself goes only once no address still expects it.
 *
 * Any block recorded against this address goes too. It describes a refusal
 * that can no longer happen, and leaving it behind would refuse the next join
 * by a rule about a membership that has ended.
 */
export function forgetHost(host: string): void {
  const index = readHostIndex();
  const keyId = index[host];

  delete index[host];
  writeJson(HOST_INDEX_KEY, index);

  writeJson(
    BLOCKLIST_KEY,
    listBlocked().filter((b) => b.host !== host),
  );

  if (!keyId) return;

  const stillExpected = Object.values(index).includes(keyId);
  if (stillExpected) return;

  const pins = listPins();
  delete pins[keyId];
  writeJson(PINS_KEY, pins);
}

// ── Blocklist ───────────────────────────────────────────────────────

export function listBlocked(): BlockedServer[] {
  return readJson<BlockedServer[]>(BLOCKLIST_KEY, []);
}

export function isBlocked(keyId: string): boolean {
  return listBlocked().some((b) => b.keyId === keyId);
}

export function blockServer(entry: BlockedServer): void {
  const blocked = listBlocked().filter(
    (b) => !(b.host === entry.host && b.keyId === entry.keyId),
  );
  blocked.push(entry);
  writeJson(BLOCKLIST_KEY, blocked);
}

/**
 * Lift a block, for the self-hoster who really did rebuild their server.
 *
 * Also drops the stale expectation for that address, so the next join is a
 * clean first join rather than an immediate second refusal by the same rule.
 * Without this the unblock button would appear not to work.
 */
export function unblockServer(entry: BlockedServer): void {
  writeJson(
    BLOCKLIST_KEY,
    listBlocked().filter((b) => !(b.host === entry.host && b.keyId === entry.keyId)),
  );

  const index = readHostIndex();
  delete index[entry.host];
  writeJson(HOST_INDEX_KEY, index);
}

// ── JWT verification ────────────────────────────────────────────────

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * RFC 7638 thumbprint. The member order below is required, not stylistic: the
 * hash is taken over a canonical JSON object with keys in lexicographic order
 * and no whitespace. Get it wrong and every thumbprint silently disagrees with
 * the server's.
 */
export async function jwkThumbprint(jwk: JsonWebKey): Promise<string> {
  if (jwk.kty !== "EC" || !jwk.crv || !jwk.x || !jwk.y) {
    throw new Error("Not an EC public JWK");
  }
  const canonical = JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return base64UrlEncode(digest);
}

async function verifySignature(
  jwk: JsonWebKey,
  signingInput: string,
  signature: Uint8Array,
): Promise<boolean> {
  // Strip anything that would make importKey reject a key we only ever verify
  // with, and make sure we never import a private half by accident.
  const publicJwk: JsonWebKey = {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
  };
  const key = await crypto.subtle.importKey("jwk", publicJwk, IMPORT_ALGO, false, [
    "verify",
  ]);
  // A JWS ES256 signature is raw R||S, which is exactly what WebCrypto expects.
  return crypto.subtle.verify(
    VERIFY_ALGO,
    key,
    signature as unknown as BufferSource,
    new TextEncoder().encode(signingInput),
  );
}

interface ParsedProof {
  keyId: string;
  jwk: JsonWebKey;
  nonce: string;
  host?: string;
  signingInput: string;
  signature: Uint8Array;
}

async function parseProof(proof: string): Promise<ParsedProof | ServerProofFailure> {
  const parts = proof.split(".");
  if (parts.length !== 3) {
    return { reason: "malformed", detail: "Not a three-part JWT" };
  }

  let header: { alg?: string; kid?: string; jwk?: JsonWebKey };
  let payload: { nonce?: string; iss?: string; exp?: number; iat?: number; host?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch (e) {
    return { reason: "malformed", detail: `Undecodable JWT: ${String(e)}` };
  }

  if (header.alg !== "ES256") {
    // Refuse to be talked into another algorithm by the token itself. "none"
    // is the classic version of this.
    return { reason: "malformed", detail: `Unexpected alg "${header.alg}"` };
  }
  if (!header.jwk) {
    return { reason: "malformed", detail: "Proof carries no key" };
  }
  if (typeof payload.nonce !== "string") {
    return { reason: "malformed", detail: "Proof carries no nonce" };
  }

  let keyId: string;
  try {
    keyId = await jwkThumbprint(header.jwk);
  } catch (e) {
    return { reason: "malformed", detail: String(e) };
  }

  // kid and iss are the server's claims about its own key. They have to agree
  // with the key actually present, or the identity we file it under is not the
  // one that signed.
  if (header.kid && header.kid !== keyId) {
    return { reason: "malformed", detail: "Header kid does not match the key" };
  }
  if (payload.iss && payload.iss !== keyId) {
    return { reason: "malformed", detail: "Issuer does not match the key" };
  }

  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
    return {
      reason: "expired",
      detail: "Proof has expired",
      skewMs:
        typeof payload.iat === "number" ? Date.now() - payload.iat * 1000 : undefined,
    };
  }

  return {
    keyId,
    jwk: header.jwk,
    nonce: payload.nonce,
    host: typeof payload.host === "string" ? payload.host : undefined,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64UrlToBytes(parts[2]),
  };
}

// ── Key rotation ────────────────────────────────────────────────────

/** Refuse to walk further than this, so a malformed chain cannot loop. */
const MAX_VOUCH_HOPS = 16;

interface ParsedVouch {
  prev: string;
  next: string;
  jwk: JsonWebKey;
  signingInput: string;
  signature: Uint8Array;
}

async function parseVouch(vouch: string): Promise<ParsedVouch | null> {
  const parts = vouch.split(".");
  if (parts.length !== 3) return null;

  let header: { alg?: string; jwk?: JsonWebKey };
  let payload: { prev?: string; next?: string; jwk?: JsonWebKey; exp?: number };
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch {
    return null;
  }

  if (header.alg !== "ES256") return null;
  if (typeof payload.prev !== "string" || typeof payload.next !== "string") return null;
  if (!payload.jwk) return null;
  if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;

  // The successor key travels in the payload so we can check it hashes to the
  // key id being claimed. Without that a valid statement could name one key and
  // carry another.
  let nextThumbprint: string;
  try {
    nextThumbprint = await jwkThumbprint(payload.jwk);
  } catch {
    return null;
  }
  if (nextThumbprint !== payload.next) return null;

  return {
    prev: payload.prev,
    next: payload.next,
    jwk: payload.jwk,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64UrlToBytes(parts[2]),
  };
}

/**
 * Walk succession statements from the key we pinned to the key now answering.
 *
 * Every hop is verified against the key the *previous* hop established, starting
 * from our own pin — never against a key the chain supplied for itself. That is
 * the whole security of this: an attacker can offer any statements they like,
 * but cannot produce one signed by a key they do not hold.
 */
async function followVouchChain(
  vouches: string[],
  fromKeyId: string,
  toKeyId: string,
): Promise<{ hops: string[] } | null> {
  if (vouches.length === 0 || fromKeyId === toKeyId) return null;

  const parsed = (await Promise.all(vouches.map(parseVouch))).filter(
    (v): v is ParsedVouch => v !== null,
  );

  const pin = getPin(fromKeyId);
  if (!pin) return null;

  let currentKeyId = fromKeyId;
  let currentJwk = pin.jwk;
  const hops: string[] = [];
  const seen = new Set<string>([fromKeyId]);

  for (let i = 0; i < MAX_VOUCH_HOPS; i++) {
    const step = parsed.find((v) => v.prev === currentKeyId);
    if (!step) return null;

    // A chain that revisits a key is malformed, and following it would loop.
    if (seen.has(step.next)) return null;

    const valid = await verifySignature(currentJwk, step.signingInput, step.signature);
    if (!valid) return null;

    // A key the user blocked cannot be laundered back in through a succession.
    if (isBlocked(step.next)) return null;

    seen.add(step.next);
    hops.push(step.next);
    currentKeyId = step.next;
    currentJwk = step.jwk;

    if (currentKeyId === toKeyId) return { hops };
  }

  return null;
}

// ── The decision ────────────────────────────────────────────────────

/** 32 bytes, the same size the server uses for its own challenge nonce. */
export function createClientNonce(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Decide whether to go on talking to whatever answered at `host`.
 *
 * Deliberately does not write anything — the caller applies the outcome, so a
 * decision can be tested and logged without a pin appearing as a side effect.
 */
export async function evaluateServerProof(args: {
  host: string;
  proof: string | undefined;
  sentNonce: string;
  /** Succession statements the server offered, if it has ever rotated. */
  vouches?: string[];
}): Promise<ServerProofDecision> {
  const { host, proof, sentNonce } = args;
  const expectedKeyId = getExpectedKeyIdForHost(host);

  if (!proof) {
    // A server that proved itself here before and now offers nothing is either
    // an impostor stripping the proof or a genuine downgrade. Both need to be
    // refused: accepting silently would make the whole thing optional for an
    // attacker.
    if (expectedKeyId) {
      return {
        action: "block",
        failure: {
          reason: "proof_withdrawn",
          detail: "This address proved its identity before and no longer does.",
          expectedKeyId,
        },
      };
    }
    // Never had a proof here. An older server, so carry on unpinned rather than
    // locking people out of servers that have not been upgraded yet.
    return { action: "unauthenticated" };
  }

  const parsed = await parseProof(proof);
  if ("reason" in parsed) return { action: "block", failure: parsed };

  if (parsed.nonce !== sentNonce) {
    // Replay: a proof captured from another handshake.
    return {
      action: "block",
      failure: { reason: "nonce_mismatch", detail: "Proof answers a different challenge." },
    };
  }

  if (isBlocked(parsed.keyId)) {
    return {
      action: "block",
      failure: { reason: "blocked", detail: "This server was blocked.", keyId: parsed.keyId },
    };
  }

  if (expectedKeyId && expectedKeyId !== parsed.keyId) {
    // The server may have rotated its key on purpose. It can prove that by
    // producing a statement signed by the key we pinned which names its
    // replacement (GRYT-54). Anything that doesn't chain back to our pin is
    // still a refusal.
    const succession = await followVouchChain(args.vouches ?? [], expectedKeyId, parsed.keyId);
    if (succession) {
      return {
        action: "rotated",
        keyId: parsed.keyId,
        jwk: parsed.jwk,
        previousKeyId: expectedKeyId,
        hops: succession.hops,
      };
    }

    return {
      action: "block",
      failure: {
        reason: "key_mismatch",
        detail: "A different server is answering at this address.",
        expectedKeyId,
        presentedKeyId: parsed.keyId,
      },
    };
  }

  const pin = getPin(parsed.keyId);

  if (pin) {
    // Check against the stored key, not the one the proof carried. They are
    // provably the same key here — equal thumbprints mean equal crv/kty/x/y —
    // but verifying against the pin is the property we actually want, and it
    // should not depend on the reader reconstructing that argument.
    const valid = await verifySignature(pin.jwk, parsed.signingInput, parsed.signature);
    if (!valid) {
      return {
        action: "block",
        failure: { reason: "bad_signature", detail: "Proof does not verify against the pinned key." },
      };
    }
    return {
      action: "trusted",
      keyId: parsed.keyId,
      movedFrom: pin.lastHost !== host ? pin.lastHost : undefined,
    };
  }

  // First time we have seen this key. The signature can only be checked against
  // the key the proof carried, which proves nothing on its own — an impostor
  // signs its own key just as validly. This is the trust-on-first-use moment,
  // and the same assumption SSH makes on a first connection.
  const valid = await verifySignature(parsed.jwk, parsed.signingInput, parsed.signature);
  if (!valid) {
    return {
      action: "block",
      failure: { reason: "bad_signature", detail: "Proof is not self-consistent." },
    };
  }

  return { action: "pin", keyId: parsed.keyId, jwk: parsed.jwk };
}

/** Persist whatever `evaluateServerProof` concluded. */
export function applyServerProofDecision(
  host: string,
  decision: ServerProofDecision,
): void {
  switch (decision.action) {
    case "pin":
      savePin(decision.keyId, decision.jwk, host);
      break;
    case "rotated":
      replacePin(decision.previousKeyId, decision.keyId, decision.jwk, host);
      break;
    case "trusted": {
      const pin = getPin(decision.keyId);
      if (pin) savePin(decision.keyId, pin.jwk, host);
      break;
    }
    case "block":
      // Every failure refuses *this* connection. Only the two that mean
      // "something else is answering where a known server used to" become a
      // standing block. A malformed or expired proof is far more likely to be
      // a bug or a clock than an attack, and permanently blocking on one would
      // turn a transient fault into a server the user cannot reach again
      // without finding a settings screen.
      if (decision.failure.reason === "key_mismatch") {
        blockServer({
          host,
          keyId: decision.failure.presentedKeyId,
          expectedKeyId: decision.failure.expectedKeyId,
          blockedAt: Date.now(),
          reason: "key_mismatch",
        });
      } else if (decision.failure.reason === "proof_withdrawn") {
        blockServer({
          host,
          expectedKeyId: decision.failure.expectedKeyId,
          blockedAt: Date.now(),
          reason: "proof_withdrawn",
        });
      }
      break;
    case "unauthenticated":
      break;
  }
}
