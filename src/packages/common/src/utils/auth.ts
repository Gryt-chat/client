/**
 * Check if user has all required authentication tokens
 * @returns true if user is properly authenticated, false otherwise
 */
import { getKeycloak } from "../auth/keycloak";
import { clearAllServerTokens, getServerAccessToken } from "./tokenStorage";

export function isUserAuthenticated(): boolean {
  // We intentionally do NOT store Keycloak tokens in localStorage for security.
  // Authentication should be derived from the Keycloak adapter state.
  try {
    const kc = getKeycloak();
    return !!(kc.authenticated && kc.token);
  } catch {
    return false;
  }
}

/**
 * Clear all authentication data and sign user out
 */
export function signOut(): void {
  console.log("[Auth:SignOut] signOut() called — clearing legacy tokens and server tokens");
  localStorage.removeItem('token');
  clearAllServerTokens();
}

/**
 * Force sign out user using useAccount logout
 * This function should be called from components that have access to useAccount
 */
export function forceSignOutWithAccount(logout: () => void): void {
  clearAllServerTokens();
  logout();
}

/**
 * Check authentication on app launch and force sign out if missing required tokens
 */
export function checkAuthenticationOnLaunch(): boolean {
  // Do NOT force sign-out on app launch.
  // With OIDC, the Keycloak adapter restores the session asynchronously (check-sso),
  // so a synchronous localStorage check is both unreliable and harms UX.
  return true;
}

/**
 * Check if user can use a specific server (has access token or can get one)
 */
export function canUseServer(serverHost: string): boolean {
  const accessToken = getServerAccessToken(serverHost);
  
  // Can use server if we have an access token; otherwise Keycloak token will be fetched on demand.
  return !!accessToken;
}
