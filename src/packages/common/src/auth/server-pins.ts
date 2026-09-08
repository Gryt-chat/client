import { base64Url as sharedBase64Url, base64UrlDecode as sharedBase64UrlDecode } from "@gryt/crypto";
/**
 * Trust-on-first-use pinning of server identity keys. **`server_id` from mDNS is a
 * discovery hint, never a credential; pins are filed under the key, not host:port.**
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
   * The key this server was *first* pinned under, carried across rotations, so it
   * names the server. Absent on older pins, where today's key is the origin.
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
       * How far the server's clock sits behind ours, negative if ahead. From
       * `iat`, the one instant both sides describe.
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
 * Which key we last saw at an address — a hint for spotting a *substitution*. The
 * pin is filed under the key, so this going stale costs recognition, not safety.
 */
function readHostIndex(): Record<string, string> {
  return readJson<Record<string, string>>(HOST_INDEX_KEY, {});
}

export function getExpectedKeyIdForHost(host: string): string | null {
  return readHostIndex()[host] ?? null;
}

/**
 * A name for the server at an address that survives both moving and rotating.
 * Null when the server offered no proof.
 */
export function getOriginKeyIdForHost(host: string): string | null {
  const keyId = getExpectedKeyIdForHost(host);
  if (!keyId) return null;
  return listPins()[keyId]?.originKeyId ?? keyId;
}

/**
 * Every address we currently expect a key at. Read-only: the settings screen tells
 * an orphaned pin from one still in use at another address.
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
 * Succeed one pinned key with another after a proven rotation. **Every address
 * that expected the old key moves**, or the rest drop to first-join (GRYT-54).
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
    // Carries over for the same reason `firstSeenAt` does: a key change is not a
    // different server, and anything filed under the lineage survives.
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
 * Forget everything this client knows about one address — what leaving a server
 * should do. **Deliberately not `forgetPin`**: one key answers at several hosts.
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
 * Lift a block, for the self-hoster who really did rebuild their server. Also
 * drops the stale expectation, or the next join is refused by the same rule.
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

/* Both are @gryt/crypto's now. Its decoder takes either alphabet and padding or
   none of it (GRYT-898). */
const base64UrlToBytes = sharedBase64UrlDecode;

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  return sharedBase64Url(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
}

/**
 * RFC 7638 thumbprint. The member order below is required, not stylistic: the hash
 * is over canonical JSON with keys in lexicographic order and no whitespace.
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

  // kid and iss are the server's claims about its own key. They have to agree with
  // the key actually present, or we file it under an identity that did not sign.
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

  // The successor key travels in the payload so we can check it hashes to the key
  // id being claimed. Otherwise a valid statement could name one and carry another.
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
 * **Every hop is verified against the key the previous hop established.**
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
 * Decide whether to go on talking to whatever answered at `host`. Deliberately
 * writes nothing, so a decision can be tested without a pin as a side effect.
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
    // A server that proved itself here before and now offers nothing is either an
    // impostor stripping the proof or a downgrade. Both have to be refused.
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
    // The server may have rotated on purpose, and can prove it with a statement
    // signed by the key we pinned. Anything not chaining back is a refusal.
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
    // provably equal here, but verifying against the pin is the property wanted.
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
  // the key the proof carried, which proves nothing — this is the TOFU moment.
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
      // Every failure refuses *this* connection. Only the two meaning "something
      // else is answering where a known server used to" become a standing block.
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
