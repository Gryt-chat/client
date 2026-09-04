import { getGrytConfig } from "../../../../config";
import { decodeJwt } from "./jwt";
import { getValidIdentityToken } from "./keycloak";

export interface KeycloakCredential {
  id: string;
  type: string;
  userLabel: string;
  createdDate: number;
  credentialData?: string;
}

interface KeycloakCredentialContainer {
  type: string;
  userCredentialMetadatas: { credential: KeycloakCredential }[];
}

function getAccountApiBase(): string {
  const cfg = getGrytConfig();
  return `${cfg.GRYT_OIDC_ISSUER}/account`;
}

async function accountFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getValidIdentityToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${getAccountApiBase()}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Account API ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`,
    );
  }

  return res;
}

/**
 * The account as Keycloak represents it, with whatever attributes the realm's
 * user profile declares.
 *
 * Separate from `AccountProfile`, which is the shape the settings panel shows a
 * person. This one is the wire format, and it exists so `message-vault` can
 * read an attribute and write it back without this module having to know what
 * the attribute means.
 */
export async function getAccountRepresentation(): Promise<Record<string, unknown>> {
  const res = await accountFetch("/");
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Replace the account representation.
 *
 * Replace, not patch — Keycloak takes the whole object, so anything left out is
 * a request to unset it. Callers read first and send back what they were given
 * with their one change applied.
 */
export async function putAccountRepresentation(account: Record<string, unknown>): Promise<void> {
  await accountFetch("/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(account),
  });
}

export interface AccountProfile {
  sub?: string;
  email?: string;
  /**
   * When the account was created, if it can be had.
   *
   * Usually it cannot. Keycloak keeps `createdTimestamp` on the user, but only
   * the admin API exposes it and a person's own token is not allowed there. The
   * account API returns the profile and not that field. So this is populated
   * only when the realm has been configured to put it in the token, and the UI
   * leaves the row out rather than showing a date it had to invent.
   */
  createdAt?: number;
}

function decodeTokenClaims(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return decodeJwt<Record<string, unknown>>(token);
  } catch {
    return null;
  }
}

/**
 * Who the signed-in account is, for showing back to its owner.
 *
 * The id comes from the token, which is the only place it is authoritative.
 * The rest comes from the account API, and a failure there is not worth
 * surfacing — the panel simply shows less.
 */
export async function getAccountProfile(): Promise<AccountProfile> {
  const token = await getValidIdentityToken();
  if (!token) throw new Error("Not authenticated");

  const claims = decodeTokenClaims(token) ?? {};
  const profile: AccountProfile = {
    sub: typeof claims.sub === "string" ? claims.sub : undefined,
    email: typeof claims.email === "string" ? claims.email : undefined,
    createdAt:
      typeof claims.created_at === "number"
        ? claims.created_at * 1000
        : undefined,
  };

  try {
    const res = await accountFetch("/");
    const account = (await res.json()) as {
      email?: string;
    };
    if (account.email) profile.email = account.email;
  } catch {
    // Token claims are enough to show something useful.
  }

  return profile;
}

export async function fetchCredentials(): Promise<KeycloakCredential[]> {
  const res = await accountFetch("/credentials");
  const containers: KeycloakCredentialContainer[] = await res.json();
  return containers.flatMap((c) =>
    c.userCredentialMetadatas.map((m) => m.credential),
  );
}

export async function deleteCredential(id: string): Promise<void> {
  await accountFetch(`/credentials/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function updateCredentialLabel(
  id: string,
  label: string,
): Promise<void> {
  await accountFetch(`/credentials/${encodeURIComponent(id)}/label`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: label,
  });
}
