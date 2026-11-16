import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { webcrypto } from "node:crypto";

import type { BrowserContext } from "@playwright/test";

const subtle = webcrypto.subtle;
const EC = { name: "ECDSA", namedCurve: "P-256" } as const;
const SHA = { name: "ECDSA", hash: "SHA-256" } as const;
const b64 = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString("base64url");
const json64 = (value: unknown) => b64(Buffer.from(JSON.stringify(value)));
const parse64 = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

type Jwk = { kty: string; crv: string; x: string; y: string };

/** RFC 7638, as the identity service and the apps compute it. */
async function thumbprint(jwk: Jwk): Promise<string> {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return b64(await subtle.digest("SHA-256", Buffer.from(canonical)));
}

async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: webcrypto.CryptoKey): Promise<string> {
  const input = `${json64(header)}.${json64(payload)}`;
  return `${input}.${b64(await subtle.sign(SHA, key, Buffer.from(input)))}`;
}

/** A JWS signed by the key in its own header, as the apps' seed proofs are. Its payload, or null. */
async function verifyEmbedded(jws: string): Promise<{ payload: Record<string, unknown>; jwk: Jwk } | null> {
  const [h, p, sig] = jws.split(".");
  if (!h || !p || !sig) return null;
  const header = parse64(h);
  const jwk = header.jwk as Jwk | undefined;
  if (header.alg !== "ES256" || !jwk) return null;
  const key = await subtle.importKey("jwk", jwk, EC, false, ["verify"]);
  const ok = await subtle.verify(SHA, key, Buffer.from(sig, "base64url"), Buffer.from(`${h}.${p}`));
  return ok ? { payload: parse64(p), jwk } : null;
}

/**
 * A stand-in for the identity service and its key book, for tests about accounts. One key per
 * account, as under enforce: the first seed key proven is the account's, and a certificate names it.
 */
export interface TestIdentity {
  /** What the app is pointed at. */
  url: string;
  /** What test servers trust, as the containers reach this machine. */
  issuer: string;
  /** Certificates issued so far, by account. */
  issued: Map<string, number>;
  /** Puts a key in the book that none of the account's devices made, as a finished reset would. */
  addKey(sub: string, thumb: string): void;
  stop(): Promise<void>;
}

interface Account {
  keys: string[];
  book: { day: string; thumb: string; how: string }[];
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" };
const today = () => new Date().toISOString().slice(0, 10);

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(JSON.stringify(value));
}

async function seedKeyOf(proof: unknown, sub: string): Promise<string | null> {
  if (typeof proof !== "string") return null;
  const checked = await verifyEmbedded(proof).catch(() => null);
  return checked && checked.payload.sub === sub && checked.payload.cnf ? thumbprint(checked.jwk) : null;
}

export async function startIdentity(): Promise<TestIdentity> {
  const ca = await subtle.generateKey(EC, true, ["sign", "verify"]);
  const { kty, crv, x, y } = (await subtle.exportKey("jwk", ca.publicKey)) as Jwk;
  const caJwk = { kty, crv, x, y, kid: "e2e", alg: "ES256", use: "sig" };
  const accounts = new Map<string, Account>();
  const account = (sub: string) => accounts.get(sub) ?? (accounts.set(sub, { keys: [], book: [] }), accounts.get(sub)!);
  let issuer = "";
  const issued = new Map<string, number>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "OPTIONS") return send(res, 204, null);
    if (url.pathname === "/.well-known/jwks.json") return send(res, 200, { keys: [caJwk] });
    const book = url.pathname.match(/^\/api\/v1\/account-key\/book\/(.+)$/);
    if (book) {
      const a = account(decodeURIComponent(book[1]));
      return send(res, 200, { keys: a.keys.map((thumb) => ({ thumb, since: today() })), book: a.book });
    }
    // Pairing is someone else's test: held open, as the guest fixtures do.
    if (url.pathname.startsWith("/api/v1/pairing/")) return;
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const sub = token ? (parse64(token.split(".")[1] ?? "e30").sub as string | undefined) : undefined;
    if (!sub) return send(res, 401, { error: "unauthorized" });
    const input = await body(req);
    const a = account(sub);
    const seed = await seedKeyOf(input.proof, sub);
    if (url.pathname === "/api/v1/certificate") {
      if (seed && a.keys.length === 0) {
        a.keys.push(seed);
        a.book.push({ day: today(), thumb: seed, how: "first" });
      }
      if (!seed || !a.keys.includes(seed)) return send(res, 403, { error: "approval_required", resetAt: null });
      const now = Math.floor(Date.now() / 1000);
      const certificate = await signJwt(
        { alg: "ES256", kid: "e2e", typ: "JWT" },
        { iss: issuer, sub, jwk: input.jwk, seed, preferred_username: sub, iat: now, exp: now + 3600 },
        ca.privateKey,
      );
      issued.set(sub, (issued.get(sub) ?? 0) + 1);
      return send(res, 200, { certificate });
    }
    if (url.pathname === "/api/v1/account-key/status") return send(res, 200, { known: !!seed && a.keys.includes(seed), multi: false, resetAt: null });
    if (url.pathname === "/api/v1/account-key/claim") return send(res, 200, { result: "single" });
    return send(res, 404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  const { port } = server.address() as AddressInfo;
  issuer = `http://host.docker.internal:${port}`;

  return {
    url: `http://127.0.0.1:${port}`,
    issuer,
    issued,
    addKey(sub, thumb) {
      const a = account(sub);
      a.keys.push(thumb);
      a.book.push({ day: today(), thumb, how: "reset" });
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const fakeJwt = (claims: Record<string, unknown>) => `${json64({ alg: "none", typ: "JWT" })}.${json64(claims)}.`;

/** Signed in to an account on this context's next page, the way a browser signed in by linking is. */
export async function signIn(context: BrowserContext, identity: TestIdentity, sub: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub, iat: now, exp: now + 3600, iss: "https://auth.gryt.chat/realms/gryt", typ: "Bearer", preferred_username: sub, email: `${sub}@example.com` };
  const tokens = { access_token: fakeJwt(claims), refresh_token: fakeJwt({ ...claims, typ: "Refresh" }), id_token: fakeJwt({ ...claims, typ: "ID" }), expires_at: Date.now() + 3_600_000 };
  // Refreshing hands back the same tokens; the account page is only read for its links.
  // Sent with credentials, so the origin has to be named rather than "*".
  const cors = (origin: string | undefined) => ({ "access-control-allow-origin": origin ?? "*", "access-control-allow-credentials": "true" });
  await context.route("https://auth.gryt.chat/realms/gryt/protocol/openid-connect/token", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: cors(route.request().headers().origin), body: JSON.stringify({ ...tokens, expires_in: 3600 }) }),
  );
  await context.route("https://auth.gryt.chat/realms/gryt/account/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: cors(route.request().headers().origin), body: "{}" }),
  );
  await context.addInitScript(({ url, value }) => {
    localStorage.setItem("gryt_linked_session", "1");
    localStorage.setItem("gryt_electron_tokens", value);
    localStorage.setItem("gryt_custom_identity", url);
  }, { url: identity.url, value: JSON.stringify(tokens) });
}
