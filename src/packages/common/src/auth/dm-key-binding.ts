/**
 * Saying that a DM key and an identity key belong to the same person (GRYT-720).
 *
 * `dm-keys.ts` derives the key a message is encrypted to. Nothing says whose it
 * is, and a key handed over by a server that could have made it up is worth
 * nothing — a server that wanted to read a conversation would give each side its
 * own key and relay.
 *
 * This is one link of the chain that answers that: a short JWT, signed by the
 * per-server identity key, saying "this DM public key is mine, on this server".
 *
 * ## What it proves, exactly
 *
 * That whoever holds the identity key also chose this DM key. Nothing else. In
 * particular it does **not** say whose identity key it is — the public half
 * rides in the header, so a server can mint a keypair and sign a perfectly
 * valid binding with it.
 *
 * That is not a hole in this file, it is where the problem actually lives.
 * Nothing verifiable in band can say who a key belongs to; the regress stops at
 * something pinned earlier or something compared out of band, and at nothing
 * else. What this buys is that the two keys are now one thing to substitute
 * instead of two, and the identity key is the one the server challenged at join
 * — so a server handing out a forged binding is contradicting a proof it
 * verified itself, in front of every member at once.
 *
 * The caller pins {@link VerifiedDmKeyBinding.identityThumbprint}. That is the
 * part that means something, and `server-pins.ts` already does the same three
 * moves for server keys: pin on first sight, detect a change, refuse it.
 *
 * ## Why the key is inside the signed statement
 *
 * A server storing a DM key and a signature as two fields could serve one
 * person's key with another's signature, and a client checking them separately
 * might not notice. There is one field: the binding. The key is read out of it
 * after the signature verifies, or it is not read at all.
 */

/*
 * The `.ts` is for Node's type stripping, which `check-dm-key-binding.mjs` runs
 * this file through and which does no extension inference. `message-keys.ts`
 * carries the same one for the same reason; `dm-keys.ts` does not, because its
 * import from here is type-only and erases.
 */
import { asIdentityScope, type IdentityScope } from "./identity-seed.ts";
import { jwkThumbprint } from "./server-pins.ts";

/**
 * The `iss` a binding carries.
 *
 * Constant rather than the signer's own id, because a binding is not addressed
 * to a server and has no subject to name. What it is *for* is the thing worth
 * writing down, so a JWT that arrives on this path and says something else is
 * refused rather than read hopefully.
 */
const BINDING_ISSUER = "gryt:dm-key";

export interface VerifiedDmKeyBinding {
  /** The X25519 public key, raw bytes, once the signature has been checked. */
  dmPublicKey: Uint8Array<ArrayBuffer>;
  /**
   * The identity key that signed this, as a JWK thumbprint.
   *
   * **This is the thing to pin.** Everything else in here is a statement by
   * whoever holds that key, and is worth exactly what the key is worth.
   */
  identityThumbprint: string;
  /** The scope the binding claims, already checked against the expected one. */
  scope: IdentityScope;
  /** When it was signed, seconds since the epoch. */
  signedAt: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

/**
 * Sign the statement.
 *
 * There is no expiry. The DM key is derived from the seed and the scope, so it
 * does not roll and a binding does not go stale — and an expiry a client cannot
 * renew while offline would make old messages unreadable for a reason that has
 * nothing to do with anybody's keys. `signedAt` is there so a verifier can
 * prefer the newer of two bindings if one ever does change, which is a
 * different question from whether this one is still good.
 */
export async function signDmKeyBinding({
  dmPublicKey,
  scope,
  identityPrivateKey,
  identityPublicJwk,
  now = Math.floor(Date.now() / 1000),
}: {
  dmPublicKey: Uint8Array;
  scope: IdentityScope;
  identityPrivateKey: CryptoKey;
  /** Rides in the header, so a verifier that has never seen it can check. */
  identityPublicJwk: JsonWebKey;
  now?: number;
}): Promise<string> {
  const header = {
    alg: "ES256",
    typ: "JWT",
    jwk: identityPublicJwk,
  };
  const payload = {
    iss: BINDING_ISSUER,
    scope,
    dm: base64Url(dmPublicKey),
    iat: now,
  };

  const signingInput = `${base64Url(utf8(JSON.stringify(header)))}.${base64Url(
    utf8(JSON.stringify(payload)),
  )}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    identityPrivateKey,
    utf8(signingInput),
  );

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

/**
 * Check a binding, and refuse it rather than returning something partly checked.
 *
 * Throws on anything wrong. There is no "probably fine" here: a caller that got
 * a value back has a DM key whose signature verified under the thumbprint it was
 * handed, and a caller that did not has nothing to think about.
 *
 * `expectedScope` is required. Without it a binding signed for one server can be
 * replayed by another, which is the cheapest attack available to any operator
 * who can see a member list — and the scope is the one thing the verifier
 * already knows for certain, because it is the server it is talking to.
 */
export async function verifyDmKeyBinding(
  binding: string,
  expectedScope: IdentityScope,
): Promise<VerifiedDmKeyBinding> {
  const parts = binding.split(".");
  if (parts.length !== 3) {
    throw new Error("A DM key binding is a compact JWT with three parts.");
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
  } catch {
    throw new Error("That DM key binding is not readable.");
  }

  // Pinned rather than read off the header. `alg: "none"` is the oldest JWT bug
  // there is, and every softer version of it — accepting HS256 and verifying
  // the signature with the public key as the HMAC secret — starts with taking
  // the algorithm from the attacker.
  if (header.alg !== "ES256" || header.typ !== "JWT") {
    throw new Error("A DM key binding is ES256, and this one says otherwise.");
  }

  const jwk = header.jwk;
  if (!jwk || typeof jwk !== "object") {
    throw new Error("That DM key binding carries no key to check it with.");
  }
  if ((jwk as Record<string, unknown>).d !== undefined) {
    throw new Error("That DM key binding carries private key material.");
  }

  if (payload.iss !== BINDING_ISSUER) {
    throw new Error(`A DM key binding is issued by ${BINDING_ISSUER}.`);
  }
  if (payload.scope !== expectedScope) {
    // Replay from another server. The binding is perfectly valid there.
    throw new Error("That DM key binding was signed for a different server.");
  }
  if (typeof payload.dm !== "string" || typeof payload.iat !== "number") {
    throw new Error("That DM key binding is missing a key or a time.");
  }

  const verifyKey = await crypto.subtle.importKey(
    "jwk",
    jwk as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifyKey,
    fromBase64Url(parts[2]),
    utf8(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) {
    throw new Error("That DM key binding's signature does not check out.");
  }

  const dmPublicKey = fromBase64Url(payload.dm);
  // X25519 public keys are 32 bytes. Anything else is not one, and passing it
  // to the curve library would be the place that found out.
  if (dmPublicKey.length !== 32) {
    throw new Error(
      `A DM public key is 32 bytes, and this one is ${dmPublicKey.length}.`,
    );
  }

  return {
    dmPublicKey,
    identityThumbprint: await jwkThumbprint(jwk as JsonWebKey),
    scope: asIdentityScope(payload.scope as string),
    signedAt: payload.iat,
  };
}
