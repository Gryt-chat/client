import { base64UrlDecode } from "@gryt/crypto";

/**
 * A JWT's payload, or null for anything that is not a readable one.
 *
 * Four files decoded this themselves, all the same way: swap the alphabet back
 * and hand the result to `atob`. That works for as long as every claim anybody
 * reads is ASCII, and stops the moment one is not — `atob` returns a binary
 * string, one character per byte, so a UTF-8 name comes back as mojibake.
 * "Sivert Gullberg Hansen ø å æ" decodes as "Sivert Gullberg Hansen Ã¸ Ã¥ Ã¦".
 *
 * Nothing read a claim that could carry one at the time this was written — the
 * four call sites want `exp`, `sub`, `email` and `created_at` — so this is a
 * latent bug rather than a broken screen. It stops being latent the first time
 * somebody reads `name` or `preferred_username` off a token, which is an
 * ordinary thing to do and gives no warning.
 *
 * Byte for byte the phone's `decodeJwt`, so the two can become one the next
 * time something moves into a shared package.
 *
 * Nothing here verifies anything. A payload read this way is what the token
 * claims about itself, and the server is what decides whether that is true.
 */
export function decodeJwt<T>(token: string): T | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payload)),
    );
    if (!claims || typeof claims !== "object") return null;
    return claims as T;
  } catch {
    return null;
  }
}
