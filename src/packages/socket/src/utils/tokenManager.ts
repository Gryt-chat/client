import { jwtDecode } from "jwt-decode";
import type { Socket } from "socket.io-client";

import { getServerAccessToken, getServerRefreshToken, getValidIdentityToken } from "@/common";

interface TokenPayload {
  grytUserId: string;
  serverUserId: string;
  nickname: string;
  serverHost: string;
  exp: number;
}

export function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    const currentTime = Date.now() / 1000;
    return decoded.exp < currentTime;
  } catch (error) {
    console.error('Failed to decode token:', error);
    return true; // Assume expired if we can't decode
  }
}

export function getTokenExpiryTime(token: string): number | null {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    return decoded.exp * 1000; // Convert to milliseconds
  } catch (error) {
    console.error('Failed to decode token:', error);
    return null;
  }
}

export function shouldRefreshToken(token: string): boolean {
  try {
    const decoded = jwtDecode<TokenPayload>(token);
    const currentTime = Date.now() / 1000;
    const timeUntilExpiry = decoded.exp - currentTime;

    // Refresh if token expires in less than 5 minutes
    return timeUntilExpiry < 300;
  } catch (error) {
    console.error("Failed to decode token:", error);
    return true;
  }
}

export interface TokenRefreshSocketLike {
  connected?: boolean;
  emit: (event: "token:refresh", payload: { refreshToken?: string; identityToken?: string; accessToken?: string }) => void;
}

async function triggerTokenRefresh(host: string, socket: TokenRefreshSocketLike, accessToken: string): Promise<void> {
  const refreshToken = getServerRefreshToken(host);
  const identityToken = await getValidIdentityToken().catch(() => undefined);
  if (refreshToken && identityToken) {
    socket.emit("token:refresh", { refreshToken, identityToken });
  } else {
    socket.emit("token:refresh", { accessToken });
  }
}

export async function getFreshServerAccessToken(
  host: string,
  socket: TokenRefreshSocketLike | null | undefined,
  options?: { force?: boolean },
): Promise<string | null> {
  const current = getServerAccessToken(host);
  if (!current) return null;

  const force = options?.force === true;
  const needsRefresh = force || shouldRefreshToken(current);
  if (!needsRefresh) return current;

  if (!socket || socket.connected === false) return current;

  const staleToken = current;
  await triggerTokenRefresh(host, socket, staleToken);

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    const fresh = getServerAccessToken(host);
    if (fresh && fresh !== staleToken) return fresh;
  }

  return getServerAccessToken(host) ?? staleToken;
}

/**
 * Reads a fresh access token from storage, triggers a refresh if it's
 * near expiry or expired, waits for the refreshed token, then emits the
 * socket event with the up-to-date token in the payload.
 *
 * Returns true if the event was emitted, false if no valid token could
 * be obtained.
 */
export async function emitAuthenticated(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
  host: string,
): Promise<boolean> {
  let accessToken = getServerAccessToken(host);
  if (!accessToken) return false;

  if (shouldRefreshToken(accessToken)) {
    await triggerTokenRefresh(host, socket, accessToken);
    const staleToken = accessToken;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 150));
      const fresh = getServerAccessToken(host);
      if (fresh && fresh !== staleToken) {
        accessToken = fresh;
        break;
      }
    }
  }

  socket.emit(event, { ...payload, accessToken });
  return true;
}
