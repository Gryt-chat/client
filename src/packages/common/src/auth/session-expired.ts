/**
 * Thrown when somebody is signed in but their Keycloak session can no longer
 * produce a usable token — the refresh token has expired or been revoked.
 *
 * This is deliberately not the same as "no account". A person with no account
 * gets `undefined` and joins as their device-local identity, which is correct.
 * A person whose session lapsed must not: the server would see a different
 * `sub` and they would silently arrive as a stranger on servers they are
 * already a member of. Signing in again is the only thing that fixes it, so
 * that is what the error is for — it is the difference between "no account"
 * and "your account is unreachable", which callers could not tell apart while
 * both cases returned the same value (GRYT-10).
 */
export class SessionExpiredError extends Error {
  readonly name = "SessionExpiredError";

  constructor(message = "Your session has expired. Sign in again to continue.") {
    super(message);
  }
}

export function isSessionExpired(error: unknown): error is SessionExpiredError {
  return error instanceof SessionExpiredError;
}
