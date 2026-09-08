/**
 * The half of GRYT-719's assertion that stayed in the client. `@ts-expect-error` is
 * the assertion: if `IdentityScope` collapses back to `string`, lint fails.
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
