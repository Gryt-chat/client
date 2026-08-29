/**
 * The one thing GRYT-719 changed, asserted where a type checker can see it.
 *
 * `deriveDmKeyPair(seed, host)` and `deriveDmKeyPair(seed, scope)` are the same
 * call to read, and the difference only shows up when somebody's server changes
 * address — at which point every message encrypted to the old key is unreadable
 * and nothing says why. So the brand exists, and this is what proves it is still
 * doing its job.
 *
 * `@ts-expect-error` is the assertion. If `IdentityScope` ever collapses back to
 * `string`, these lines stop erroring, `tsc` reports the directive as unused,
 * and `yarn lint` fails — which is the CI this repo already runs. There is no
 * runtime here to check: `scripts/check-dm-keys.mjs` cannot see a type.
 *
 * Compiled and then dropped by the bundler. Nothing imports it.
 */

import { deriveDmKeyPair, dmPublicKey } from "./dm-keys";
import { asIdentityScope, deriveLocalKeyPair } from "./identity-seed";

const seed = new Uint8Array(32).fill(1);
const scope = asIdentityScope("srv:abc123");
const host = "chat.example.invalid";

/* A scope is accepted, which is the whole point of having one. */
export const derivedDm = () => deriveDmKeyPair(seed, scope);
export const derivedPublic = () => dmPublicKey(seed, scope);
export const derivedLocal = () => deriveLocalKeyPair(seed, scope);

/* An address is not. */
// @ts-expect-error a DM key must not be derived from an address (GRYT-719)
export const dmFromHost = () => deriveDmKeyPair(seed, host);
// @ts-expect-error the public half is the same derivation, so the same rule
export const publicFromHost = () => dmPublicKey(seed, host);
// @ts-expect-error the identity key has had this rule since GRYT-257
export const localFromHost = () => deriveLocalKeyPair(seed, host);
