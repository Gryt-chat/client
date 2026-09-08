import { base64UrlDecode } from "@gryt/crypto";

/**
 * A JWT's payload, or null for anything that is not a readable one. Decodes UTF-8
 * rather than `atob`. **Nothing here verifies anything.**
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
