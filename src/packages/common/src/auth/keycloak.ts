import Keycloak from 'keycloak-js';

import { getGrytConfig } from '../../../../config';
import { isElectron } from '../../../../lib/electron';
import { consumePreLoginUrl } from '../utils/preLoginUrl';
import {
  electronLogin,
  electronLogout,
  electronRegister,
  electronRequiredAction,
  getStoredTokens,
  getValidElectronToken,
  refreshTokens,
  storeTokens,
} from './electron-auth';
import { SessionExpiredError } from './session-expired';

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
let cachedPromiseLogCount = 0;

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
  const stored = await getStoredTokens();
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
          await storeTokens({
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
  const stored = await getStoredTokens();

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
      keycloakInstance = null;
    }
  } else {
    console.log("[Auth:KC] No stored tokens — will init unauthenticated");
  }

  const freshKc = getKeycloak();
  await freshKc.init({
    pkceMethod: 'S256',
    checkLoginIframe: false,
  });
  console.log("[Auth:KC] Unauthenticated init done");

  installKeycloakEventHandlers(freshKc, 'electron-unauthed');
  return { keycloak: freshKc, authenticated: false };
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
    if (cachedPromiseLogCount < 3) {
      cachedPromiseLogCount++;
      console.log("[Auth:KC] initKeycloak: returning cached promise");
    }
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
  cachedPromiseLogCount = 0;
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
  const target = redirectUri || consumePreLoginUrl() || window.location.href;
  await keycloak.login({ redirectUri: target });
}

export async function startRegister(redirectUri?: string): Promise<void> {
  if (isElectron()) {
    await electronRegister();
    resetKeycloakInit();
    await initKeycloak();
    return;
  }

  const { keycloak } = await initKeycloak();
  const target = redirectUri || consumePreLoginUrl() || window.location.href;
  await keycloak.login({
    action: 'register',
    redirectUri: target,
  });
}

/**
 * Hand somebody to Keycloak to do one thing to their own account, then bring
 * them back where they were.
 *
 * The alias is a required action registered and enabled on the realm. It runs
 * on the login pages, which are Gryt's own theme — so account management never
 * sends anybody to the stock Keycloak console, which is PatternFly and looks
 * nothing like the rest of this.
 *
 * **A disabled action fails quietly.** Keycloak ignores a `kc_action` it does
 * not recognise and simply completes the login, so the button appears to do
 * nothing at all rather than reporting an error. If one of these looks dead,
 * check the realm's required actions before looking at this file.
 */
export async function startRequiredAction(
  action: string,
  redirectUri?: string,
): Promise<void> {
  if (isElectron()) {
    await electronRequiredAction(action);
    resetKeycloakInit();
    await initKeycloak();
    return;
  }

  const { keycloak } = await initKeycloak();
  await keycloak.login({
    action,
    redirectUri: redirectUri || window.location.href,
  });
}

export async function startPasskeySetup(redirectUri?: string): Promise<void> {
  return startRequiredAction('webauthn-register-passwordless', redirectUri);
}

/** Change the password. Enabled on the realm as UPDATE_PASSWORD. */
export async function startPasswordChange(redirectUri?: string): Promise<void> {
  return startRequiredAction('UPDATE_PASSWORD', redirectUri);
}

/**
 * Change the address on the account.
 *
 * The realm sets `registrationEmailAsUsername`, so this changes what somebody
 * signs in with, and Keycloak re-verifies the new address before it takes
 * effect. Needs the `update-email` feature flag as well as the required action.
 */
export async function startEmailChange(redirectUri?: string): Promise<void> {
  return startRequiredAction('UPDATE_EMAIL', redirectUri);
}

/** Set up one-time recovery codes. Needs the `recovery-codes` feature flag. */
export async function startRecoveryCodesSetup(redirectUri?: string): Promise<void> {
  return startRequiredAction('CONFIGURE_RECOVERY_AUTHN_CODES', redirectUri);
}

/** Set up an authenticator app. Enabled on the realm as CONFIGURE_TOTP. */
export async function startTotpSetup(redirectUri?: string): Promise<void> {
  return startRequiredAction('CONFIGURE_TOTP', redirectUri);
}

/**
 * Delete the account, permanently.
 *
 * Keycloak asks for confirmation on its own page before doing anything, and
 * that page is styled here (auth#19). Because this arrives as an
 * application-initiated action it also offers a way back, which it would not if
 * somebody reached it any other way.
 *
 * This deletes the gryt.chat account. It does not delete anything on servers
 * other people run — those hold their own copy of what was said.
 */
export async function startAccountDeletion(redirectUri?: string): Promise<void> {
  return startRequiredAction('delete_account', redirectUri);
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
    // This is the refresh. updateToken resolves false when the token is still
    // fresh enough and only rejects when it could not get a new one, so a
    // rejection here means the session is genuinely over.
    await keycloak.updateToken(minValiditySeconds);
  } catch (e) {
    // Returning keycloak.token here used to hand the caller the expired token
    // it had just failed to renew. Every request made with it came back 401,
    // which reads like the far end is broken rather than like the session
    // ending, and the one place that mattered — the identity certificate the
    // join handshake needs — failed in a way nothing retried (GRYT-10).
    console.warn("[Auth:KC] getValidIdentityToken: updateToken failed — session expired", e);
    throw new SessionExpiredError();
  }
  const hasToken = !!keycloak.token;
  if (!hasToken) console.warn("[Auth:KC] getValidIdentityToken: no token after updateToken");
  return keycloak.token || undefined;
}
