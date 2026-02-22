import Keycloak from 'keycloak-js';

import { getGrytConfig } from '../../../../config';
import { isElectron } from '../../../../lib/electron';
import {
  electronLogin,
  electronLogout,
  electronRegister,
  getStoredTokens,
  getValidElectronToken,
  refreshTokens,
  storeTokens,
} from './electron-auth';

type KeycloakInitResult = {
  keycloak: Keycloak;
  authenticated: boolean;
};

function deriveKeycloakBaseUrl(issuer: string): string {
  const i = issuer.replace(/\/+$/, '');
  const idx = i.indexOf('/realms/');
  return idx === -1 ? i : i.slice(0, idx);
}

let keycloakInstance: Keycloak | null = null;
let initPromise: Promise<KeycloakInitResult> | null = null;
let handlersInstalled = false;
let refreshTimerHandle: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer(): void {
  if (refreshTimerHandle) {
    clearTimeout(refreshTimerHandle);
    refreshTimerHandle = null;
  }
}

function parseJwtPayload(token: string): Record<string, unknown> {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

async function refreshElectronKeycloakToken(keycloak: Keycloak): Promise<void> {
  const stored = getStoredTokens();
  if (!stored) throw new Error("No stored tokens for Electron refresh");
  const newTokens = await refreshTokens(stored.refresh_token);
  keycloak.token = newTokens.access_token;
  keycloak.refreshToken = newTokens.refresh_token;
  keycloak.idToken = newTokens.id_token;
  keycloak.tokenParsed = parseJwtPayload(newTokens.access_token) as typeof keycloak.tokenParsed;
  console.log("[Auth:KC] Electron token refresh succeeded — new exp:", keycloak.tokenParsed?.exp);
}

function scheduleProactiveRefresh(keycloak: Keycloak): void {
  clearRefreshTimer();

  const exp = keycloak.tokenParsed?.exp;
  if (!exp) return;

  const now = Math.floor(Date.now() / 1000);
  const ttl = exp - now;

  if (ttl <= 0) {
    doProactiveRefresh(keycloak);
    return;
  }

  const refreshIn = Math.max(10, Math.min(ttl * 0.75, ttl - 30));
  console.log(`[Auth:KC] Scheduling proactive token refresh in ${Math.round(refreshIn)}s (token TTL: ${ttl}s)`);

  refreshTimerHandle = setTimeout(() => doProactiveRefresh(keycloak), refreshIn * 1000);
}

async function doProactiveRefresh(keycloak: Keycloak): Promise<void> {
  console.log("[Auth:KC] Proactive token refresh triggered");
  try {
    if (isElectron()) {
      await refreshElectronKeycloakToken(keycloak);
    } else {
      await keycloak.updateToken(70);
      console.log("[Auth:KC] Proactive refresh (browser) succeeded — new exp:", keycloak.tokenParsed?.exp);
    }
    scheduleProactiveRefresh(keycloak);
  } catch (e) {
    console.error("[Auth:KC] Proactive refresh failed:", e);
    refreshTimerHandle = setTimeout(() => doProactiveRefresh(keycloak), 30_000);
  }
}

export function getKeycloak(): Keycloak {
  if (keycloakInstance) return keycloakInstance;

  const cfg = getGrytConfig();
  const url = deriveKeycloakBaseUrl(cfg.GRYT_OIDC_ISSUER);

  keycloakInstance = new Keycloak({
    url,
    realm: cfg.GRYT_OIDC_REALM,
    clientId: cfg.GRYT_OIDC_CLIENT_ID,
  });

  return keycloakInstance;
}

// ── Electron-specific init ───────────────────────────────────────────────

function installKeycloakEventHandlers(keycloak: Keycloak, context: string): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  keycloak.onTokenExpired = async () => {
    console.warn("[Auth:KC] onTokenExpired fired — attempting refresh");
    try {
      if (isElectron()) {
        await refreshElectronKeycloakToken(keycloak);
        scheduleProactiveRefresh(keycloak);
      } else {
        await keycloak.updateToken(30);
        console.log("[Auth:KC] updateToken succeeded — authenticated:", keycloak.authenticated);
        if (keycloak.token && keycloak.refreshToken && keycloak.idToken) {
          storeTokens({
            access_token: keycloak.token,
            refresh_token: keycloak.refreshToken,
            id_token: keycloak.idToken,
            expires_at: (keycloak.tokenParsed?.exp ?? 0) * 1000,
          });
        }
      }
    } catch (e) {
      console.error("[Auth:KC] Token refresh FAILED — user needs to re-login", e);
    }
  };

  keycloak.onAuthRefreshSuccess = () => {
    console.log("[Auth:KC] onAuthRefreshSuccess — authenticated:", keycloak.authenticated);
  };

  keycloak.onAuthRefreshError = () => {
    console.error("[Auth:KC] onAuthRefreshError — authenticated:", keycloak.authenticated,
      "token present:", !!keycloak.token);
  };

  keycloak.onAuthLogout = () => {
    console.error("[Auth:KC] onAuthLogout fired! This is likely causing the random sign-out.",
      "context:", context);
  };

  keycloak.onAuthSuccess = () => {
    console.log("[Auth:KC] onAuthSuccess");
  };

  keycloak.onAuthError = (errorData) => {
    console.error("[Auth:KC] onAuthError:", errorData);
  };

  keycloak.onReady = (authenticated) => {
    console.log("[Auth:KC] onReady — authenticated:", authenticated);
  };

  scheduleProactiveRefresh(keycloak);
}

async function initKeycloakForElectron(): Promise<KeycloakInitResult> {
  console.log("[Auth:KC] initKeycloakForElectron starting…");
  const keycloak = getKeycloak();
  const stored = getStoredTokens();

  if (stored) {
    const ttl = stored.expires_at - Date.now();
    console.log("[Auth:KC] Found stored tokens — TTL:", Math.round(ttl / 1000), "s");
    try {
      let tokens = stored;
      if (ttl < 30_000) {
        console.log("[Auth:KC] Tokens near expiry, attempting refresh…");
        try {
          tokens = await refreshTokens(stored.refresh_token);
          console.log("[Auth:KC] Pre-init refresh succeeded");
        } catch (e) {
          console.warn("[Auth:KC] Pre-init refresh failed, using existing tokens:", e);
        }
      }

      console.log("[Auth:KC] Calling keycloak.init() with tokens…");
      await keycloak.init({
        token: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        pkceMethod: 'S256',
        checkLoginIframe: false,
      });
      console.log("[Auth:KC] keycloak.init() done — authenticated:", keycloak.authenticated,
        "tokenParsed.exp:", keycloak.tokenParsed?.exp,
        "now:", Math.floor(Date.now() / 1000));

      installKeycloakEventHandlers(keycloak, 'electron');
      return { keycloak, authenticated: !!keycloak.authenticated };
    } catch (e) {
      console.warn("[Auth:KC] Init with stored tokens failed, falling through to unauthenticated:", e);
    }
  } else {
    console.log("[Auth:KC] No stored tokens — will init unauthenticated");
  }

  await keycloak.init({
    pkceMethod: 'S256',
    checkLoginIframe: false,
  });
  console.log("[Auth:KC] Unauthenticated init done");

  installKeycloakEventHandlers(keycloak, 'electron-unauthed');
  return { keycloak, authenticated: false };
}

// ── Standard browser init ────────────────────────────────────────────────

async function initKeycloakForBrowser(): Promise<KeycloakInitResult> {
  console.log("[Auth:KC] initKeycloakForBrowser starting…");
  const keycloak = getKeycloak();

  const SSO_TIMEOUT_MS = 8_000;

  const authenticated = await Promise.race([
    keycloak.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      checkLoginIframe: false,
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    }),
    new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error('SSO check timed out')), SSO_TIMEOUT_MS),
    ),
  ]).catch((err) => {
    console.warn('[Auth:KC] Silent SSO check failed, continuing as unauthenticated:', err);
    return false;
  });

  console.log("[Auth:KC] Browser init result — authenticated:", authenticated,
    "tokenParsed.exp:", keycloak.tokenParsed?.exp,
    "now:", Math.floor(Date.now() / 1000));

  installKeycloakEventHandlers(keycloak, 'browser');
  return { keycloak, authenticated };
}

// ── Public API ───────────────────────────────────────────────────────────

export async function initKeycloak(): Promise<KeycloakInitResult> {
  if (initPromise) {
    console.log("[Auth:KC] initKeycloak: returning cached promise");
    return initPromise;
  }

  const env = isElectron() ? 'electron' : 'browser';
  console.log("[Auth:KC] initKeycloak: first call, env:", env);
  initPromise = isElectron() ? initKeycloakForElectron() : initKeycloakForBrowser();

  return initPromise;
}

/**
 * Reset the init promise so the next call to initKeycloak() re-initializes.
 * Used after Electron login/logout to pick up new tokens.
 */
export function resetKeycloakInit(): void {
  console.log("[Auth:KC] resetKeycloakInit — clearing instance and handlers");
  clearRefreshTimer();
  initPromise = null;
  handlersInstalled = false;
  keycloakInstance = null;
}

export async function startLogin(redirectUri?: string): Promise<void> {
  if (isElectron()) {
    await electronLogin();
    // After successful login, re-init keycloak with the new tokens
    resetKeycloakInit();
    await initKeycloak();
    return;
  }

  const { keycloak } = await initKeycloak();
  await keycloak.login({ redirectUri: redirectUri || window.location.href });
}

export async function startRegister(redirectUri?: string): Promise<void> {
  if (isElectron()) {
    await electronRegister();
    resetKeycloakInit();
    await initKeycloak();
    return;
  }

  const { keycloak } = await initKeycloak();
  await keycloak.login({
    action: 'register',
    redirectUri: redirectUri || window.location.href,
  });
}

export async function doLogout(): Promise<void> {
  if (isElectron()) {
    await electronLogout();
    resetKeycloakInit();
    return;
  }

  const { keycloak } = await initKeycloak();
  await keycloak.logout({ redirectUri: window.location.origin });
}

export async function fetchRegistrationAllowed(): Promise<boolean> {
  const cfg = getGrytConfig();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    const res = await fetch(cfg.GRYT_OIDC_ISSUER, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.registrationAllowed;
  } catch {
    return false;
  }
}

export async function getValidIdentityToken(minValiditySeconds: number = 30): Promise<string | undefined> {
  if (isElectron()) {
    return getValidElectronToken();
  }

  const { keycloak, authenticated } = await initKeycloak();
  if (!authenticated) {
    console.log("[Auth:KC] getValidIdentityToken: not authenticated");
    return undefined;
  }
  try {
    await keycloak.updateToken(minValiditySeconds);
  } catch (e) {
    console.warn("[Auth:KC] getValidIdentityToken: updateToken failed", e);
  }
  const hasToken = !!keycloak.token;
  if (!hasToken) console.warn("[Auth:KC] getValidIdentityToken: no token after updateToken");
  return keycloak.token || undefined;
}
