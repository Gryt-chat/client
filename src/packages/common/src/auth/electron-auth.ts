import { getGrytConfig } from "../../../../config";
import { getElectronAPI } from "../../../../lib/electron";
import { SessionExpiredError } from "./session-expired";

const STORAGE_KEY = "gryt_electron_tokens";

export interface ElectronTokens {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_at: number;
}

// ── PKCE helpers ─────────────────────────────────────────────────────────

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const codeVerifier = generateRandomString(64);
  const hash = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hash);
  return { codeVerifier, codeChallenge };
}

// ── Token storage ────────────────────────────────────────────────────────

/**
 * Tokens sealed by the OS keychain (GRYT-264).
 *
 * The refresh token is the valuable half — it renews a session rather than
 * being one — and both used to sit in the app's data folder as plain text,
 * readable by anything that could read the folder.
 */
interface SealedTokens {
  sealed: string;
}

function isSealed(value: unknown): value is SealedTokens {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SealedTokens).sealed === "string"
  );
}

/** The bridge, but only when the OS will actually encrypt for us. */
async function keychain() {
  const api = getElectronAPI();
  if (!api?.secretsAvailable || !api.sealSecret) return null;
  try {
    return (await api.secretsAvailable()) ? api : null;
  } catch {
    // Throws rather than returning false on a Linux box with no keyring.
    return null;
  }
}

export async function getStoredTokens(): Promise<ElectronTokens | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    console.log("[Auth:Electron] No stored tokens found");
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    let tokens: ElectronTokens;
    if (isSealed(parsed)) {
      const api = getElectronAPI();
      if (!api?.unsealSecret) {
        throw new Error("sealed, and there is no keychain here to open them");
      }
      tokens = JSON.parse(await api.unsealSecret(parsed.sealed)) as ElectronTokens;
    } else {
      // Written before this shipped, or by the web client. Read as-is rather
      // than rejected, so an upgrade does not sign everybody out; the next
      // write seals them.
      tokens = parsed as ElectronTokens;
    }

    const ttl = tokens.expires_at - Date.now();
    console.log("[Auth:Electron] Loaded stored tokens — expires in", Math.round(ttl / 1000), "s");
    return tokens;
  } catch (e) {
    // Thrown away rather than kept, which is the opposite of what `readSeed`
    // does with an identity seed it cannot open — and deliberately so. A token
    // that will not open costs one sign-in. A seed that will not open is every
    // identity on every server, so that one has to fail loudly and leave the
    // value alone to be recovered. Here there is nothing to recover, and
    // leaving unreadable tokens in place would retry and fail on every launch.
    console.warn("[Auth:Electron] Could not read stored tokens, signing out:", e);
    clearStoredTokens();
    return null;
  }
}

export async function storeTokens(tokens: ElectronTokens): Promise<void> {
  const ttl = tokens.expires_at - Date.now();
  console.log("[Auth:Electron] Storing tokens — expires in", Math.round(ttl / 1000), "s");

  const api = await keychain();
  const payload = api
    ? JSON.stringify({ sealed: await api.sealSecret(JSON.stringify(tokens)) })
    : JSON.stringify(tokens);

  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (e) {
    // Out of storage, or blocked. Worth saying, because the symptom otherwise
    // is being asked to sign in again on the next launch for no visible reason.
    console.warn("[Auth:Electron] Could not save tokens:", e);
  }
}

export function clearStoredTokens(): void {
  console.warn("[Auth:Electron] Clearing stored tokens", new Error().stack);
  localStorage.removeItem(STORAGE_KEY);
}

// ── Token endpoint helpers ───────────────────────────────────────────────

const AUTH_FETCH_TIMEOUT_MS = 8_000;

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = AUTH_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(input, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

function getTokenEndpoint(): string {
  const cfg = getGrytConfig();
  return `${cfg.GRYT_OIDC_ISSUER}/protocol/openid-connect/token`;
}

function getLogoutEndpoint(): string {
  const cfg = getGrytConfig();
  return `${cfg.GRYT_OIDC_ISSUER}/protocol/openid-connect/logout`;
}

async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
): Promise<ElectronTokens> {
  const cfg = getGrytConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cfg.GRYT_OIDC_CLIENT_ID,
    code,
    redirect_uri: cfg.GRYT_AUTH_CALLBACK_URL,
    code_verifier: codeVerifier,
  });

  const res = await fetchWithTimeout(getTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

export async function refreshTokens(
  refreshToken: string,
): Promise<ElectronTokens> {
  console.log("[Auth:Electron] Refreshing tokens…");
  const cfg = getGrytConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cfg.GRYT_OIDC_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetchWithTimeout(getTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("[Auth:Electron] Token refresh failed:", res.status, errBody);
    clearStoredTokens();
    throw new Error(`Token refresh failed (${res.status})`);
  }

  const data = await res.json();
  const tokens: ElectronTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    id_token: data.id_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  console.log("[Auth:Electron] Token refresh succeeded — new expiry in", data.expires_in, "s");
  await storeTokens(tokens);
  return tokens;
}

// ── Login flow ───────────────────────────────────────────────────────────

let pendingLogin: {
  codeVerifier: string;
  state: string;
  resolve: (tokens: ElectronTokens) => void;
  reject: (err: Error) => void;
} | null = null;

export const LOGIN_CANCELLED = "Login cancelled";

/**
 * Cancels any in-flight Electron login/register flow.
 * The pending promise is rejected so callers can clean up.
 */
export function cancelPendingLogin(): void {
  if (!pendingLogin) return;
  const { reject } = pendingLogin;
  pendingLogin = null;
  reject(new Error(LOGIN_CANCELLED));
}

/**
 * Handles the deep-link callback URL from the OS.
 * Called by the auth-callback IPC listener.
 */
export async function handleAuthCallback(url: string): Promise<void> {
  if (!pendingLogin) return;

  const { codeVerifier, state, resolve, reject } = pendingLogin;
  pendingLogin = null;

  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    const returnedState = parsed.searchParams.get("state");

    if (!code) {
      const error = parsed.searchParams.get("error_description") || parsed.searchParams.get("error") || "No code in callback";
      throw new Error(error);
    }

    if (returnedState !== state) {
      throw new Error("State mismatch — possible CSRF attack");
    }

    const tokens = await exchangeCodeForTokens(code, codeVerifier);
    await storeTokens(tokens);
    resolve(tokens);
  } catch (err) {
    reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Opens the system browser for Keycloak login.
 * Returns a promise that resolves with tokens once the deep-link callback arrives.
 */
export async function electronLogin(): Promise<ElectronTokens> {
  const api = getElectronAPI();
  if (!api) throw new Error("Not running in Electron");

  const cfg = getGrytConfig();
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateRandomString(32);

  const authUrl = new URL(
    `${cfg.GRYT_OIDC_ISSUER}/protocol/openid-connect/auth`,
  );
  authUrl.searchParams.set("client_id", cfg.GRYT_OIDC_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", cfg.GRYT_AUTH_CALLBACK_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email offline_access");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return new Promise<ElectronTokens>((resolve, reject) => {
    pendingLogin = { codeVerifier, state, resolve, reject };
    api.openExternal(authUrl.toString());
  });
}

/**
 * Send somebody out to Keycloak to perform one required action, and come back
 * with fresh tokens.
 *
 * `kc_action` is Keycloak's application-initiated action mechanism: the alias
 * of a required action that is registered and enabled on the realm. It runs on
 * the *login* pages, which are Gryt's own theme, so nobody meets the stock
 * account console on the way.
 *
 * The realm has to have the action enabled or Keycloak ignores the parameter
 * and just logs the person in, which looks like the button doing nothing.
 * `UPDATE_EMAIL` and `CONFIGURE_RECOVERY_AUTHN_CODES` additionally need their
 * feature flags in KC_FEATURES — see auth#20.
 *
 * This was three copies of the same forty lines before, one per action, and a
 * fourth was about to be written.
 */
export async function electronRequiredAction(action: string): Promise<ElectronTokens> {
  const api = getElectronAPI();
  if (!api) throw new Error("Not running in Electron");

  const cfg = getGrytConfig();
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateRandomString(32);

  const authUrl = new URL(
    `${cfg.GRYT_OIDC_ISSUER}/protocol/openid-connect/auth`,
  );
  authUrl.searchParams.set("client_id", cfg.GRYT_OIDC_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", cfg.GRYT_AUTH_CALLBACK_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email offline_access");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("kc_action", action);

  return new Promise<ElectronTokens>((resolve, reject) => {
    pendingLogin = { codeVerifier, state, resolve, reject };
    api.openExternal(authUrl.toString());
  });
}

/** Kept for its callers; the action alias is the only thing that varied. */
export async function electronPasskeySetup(): Promise<ElectronTokens> {
  return electronRequiredAction("webauthn-register-passwordless");
}

export async function electronRegister(): Promise<ElectronTokens> {
  const api = getElectronAPI();
  if (!api) throw new Error("Not running in Electron");

  const cfg = getGrytConfig();
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = generateRandomString(32);

  const authUrl = new URL(
    `${cfg.GRYT_OIDC_ISSUER}/protocol/openid-connect/registrations`,
  );
  authUrl.searchParams.set("client_id", cfg.GRYT_OIDC_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", cfg.GRYT_AUTH_CALLBACK_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid profile email offline_access");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return new Promise<ElectronTokens>((resolve, reject) => {
    pendingLogin = { codeVerifier, state, resolve, reject };
    api.openExternal(authUrl.toString());
  });
}

/**
 * Logs out: invalidates the refresh token server-side and clears local storage.
 */
export async function electronLogout(): Promise<void> {
  const tokens = await getStoredTokens();
  if (tokens) {
    const cfg = getGrytConfig();
    try {
      await fetchWithTimeout(getLogoutEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: cfg.GRYT_OIDC_CLIENT_ID,
          refresh_token: tokens.refresh_token,
        }),
      });
    } catch {
      // best effort
    }
  }
  clearStoredTokens();
}

/**
 * Returns a valid access token, refreshing if necessary.
 * Returns undefined if not authenticated.
 */
export async function getValidElectronToken(): Promise<string | undefined> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    console.log("[Auth:Electron] getValidElectronToken: no tokens");
    return undefined;
  }

  const ttl = tokens.expires_at - Date.now();
  if (ttl < 30_000) {
    console.log("[Auth:Electron] getValidElectronToken: token near expiry (", Math.round(ttl / 1000), "s left), refreshing…");
    try {
      const refreshed = await refreshTokens(tokens.refresh_token);
      return refreshed.access_token;
    } catch (e) {
      // Not undefined. Undefined means "no account", and answerChallenge reads
      // it that way — it would answer as this device's local identity, so a
      // signed-in person whose session lapsed would silently arrive as a
      // stranger on servers they are already a member of (GRYT-10).
      console.error("[Auth:Electron] getValidElectronToken: refresh failed — session expired", e);
      throw new SessionExpiredError();
    }
  }

  return tokens.access_token;
}
