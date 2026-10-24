/** What starting again with a new message key costs on servers joined without an account. */

import { guestScopeRisk } from "./guest-history.ts";

/**
 * What a reset destroys on servers joined without an account: those keys derive
 * from the seed. **`certain` is false when the store is unreadable or empty.**
 */
export function guestIdentitiesAtRisk(): { count: number; certain: boolean } {
  try {
    return guestScopeRisk();
  } catch {
    // Belt and braces: anything `guestScopeRisk` did not expect lands here and is
    // reported as uncertain, never as a confident zero.
    return { count: 0, certain: false };
  }
}
