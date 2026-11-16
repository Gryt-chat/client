import { base64UrlDecode } from "@gryt/crypto";

/* "Approve me" asks between your own devices. The identity service signs the ticket, so a server
   can relay one but never make one up; each device still caps how many it shows. */

const MAX_PROMPTS_PER_HOUR = 3;
const seen = new Set<string>();
let shownAt: number[] = [];
let pending: string | null = null;

/** The ticket this device got with `approval_required`, sent to your other devices until it's approved. */
export function setPendingApproveTicket(ticket: string | null): void {
  pending = ticket;
}

export function pendingApproveTicket(): string | null {
  return pending;
}

let jwks: Promise<JsonWebKey[]> | null = null;
function identityKeys(): Promise<JsonWebKey[]> {
  jwks ??= import("../../../../config")
    .then(({ getGrytConfig }) => fetch(`${getGrytConfig().GRYT_IDENTITY_URL.replace(/\/+$/, "")}/.well-known/jwks.json`))
    .then((r) => (r.ok ? r.json() : { keys: [] }))
    .then((b: { keys?: JsonWebKey[] }) => b.keys ?? [])
    .catch(() => {
      jwks = null;
      return [];
    });
  return jwks;
}

const json = (part: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(part))) as Record<string, unknown>;

/** The ask's device type, when the ticket is real, for this account, fresh and not shown before. */
export async function checkApproveTicket(
  ticket: string,
  mySub: string,
  now = Date.now(),
  keys: () => Promise<JsonWebKey[]> = identityKeys,
): Promise<{ deviceType: string } | null> {
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = json(parts[0]);
    payload = json(parts[1]);
  } catch {
    return null;
  }
  if (header.typ !== "gryt-approve+jwt" || header.alg !== "ES256" || payload.purpose !== "approve-ask") return null;
  if (payload.sub !== mySub || typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
  const jti = typeof payload.jti === "string" ? payload.jti : "";
  if (!jti || seen.has(jti)) return null;

  const jwk = (await keys()).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new Uint8Array(base64UrlDecode(parts[2])),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;

  shownAt = shownAt.filter((t) => now - t < 60 * 60 * 1000);
  if (shownAt.length >= MAX_PROMPTS_PER_HOUR) return null;
  seen.add(jti);
  shownAt.push(now);
  return { deviceType: typeof payload.deviceType === "string" && payload.deviceType ? payload.deviceType : "device" };
}
