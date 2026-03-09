import { getGrytConfig } from "../../../../config";
import { getElectronAPI } from "../../../../lib/electron";

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

export function getStoredTokens(): ElectronTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      console.log("[Auth:Electron] No stored tokens found");
      return null;
    }
    const tokens = JSON.parse(raw) as ElectronTokens;
    const ttl = tokens.expires_at - Date.now();
    console.log("[Auth:Electron] Loaded stored tokens — expires in", Math.round(ttl / 1000), "s");
    return tokens;
  } catch (e) {
    console.warn("[Auth:Electron] Failed to parse stored tokens:", e);
    return null;
  }
}

export function storeTokens(tokens: ElectronTokens): void {
  const ttl = tokens.expires_at - Date.now();
  console.log("[Auth:Electron] Storing tokens — expires in", Math.round(ttl / 1000), "s");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
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
  storeTokens(tokens);
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
    storeTokens(tokens);
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

export async function electronPasskeySetup(): Promise<ElectronTokens> {
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
  authUrl.searchParams.set("kc_action", "webauthn-register-passwordless");

  return new Promise<ElectronTokens>((resolve, reject) => {
    pendingLogin = { codeVerifier, state, resolve, reject };
    api.openExternal(authUrl.toString());
  });
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
  const tokens = getStoredTokens();
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
  const tokens = getStoredTokens();
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
      console.error("[Auth:Electron] getValidElectronToken: refresh failed, returning undefined", e);
      return undefined;
    }
  }

  return tokens.access_token;
}
