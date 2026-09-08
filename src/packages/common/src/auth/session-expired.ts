/**
 * Signed in, but Keycloak can no longer produce a usable token. **Not the same as
 * "no account"**: falling through would arrive as a stranger (GRYT-10).
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
