/**
 * The half of GRYT-719's assertion that stayed in the client.
 *
 * `deriveLocalKeyPair(seed, host)` and `deriveLocalKeyPair(seed, scope)` are the
 * same call to read, and the difference only shows up when somebody's server
 * changes address — at which point the client arrives at a server it already
 * knows as a stranger, with a new `sub`, no roles and no history. So the brand
 * exists, and this is what proves it is still doing its job.
 *
 * `@ts-expect-error` is the assertion. If `IdentityScope` ever collapses back to
 * `string`, this line stops erroring, `tsc` reports the directive as unused, and
 * `yarn lint` fails. There is no runtime here to check.
 *
 * The DM half of this file moved to `@gryt/crypto` in GRYT-732, along with
 * `deriveDmKeyPair` and the brand itself. `deriveLocalKeyPair` stayed, because
 * the identity key is a `CryptoKey` the desktop hands straight to WebCrypto.
 *
 * Compiled and then dropped by the bundler. Nothing imports it.
 */

import { asIdentityScope, deriveLocalKeyPair } from "./identity-seed";

const seed = new Uint8Array(32).fill(1);
const scope = asIdentityScope("srv:abc123");
const host = "chat.example.invalid";

/* A scope is accepted, which is the whole point of having one. */
export const derivedLocal = () => deriveLocalKeyPair(seed, scope);

/* An address is not, and has not been since GRYT-257. */
// @ts-expect-error an identity key must not be derived from an address
export const localFromHost = () => deriveLocalKeyPair(seed, host);
