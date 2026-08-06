/**
 * Guards the audience of an identity assertion.
 *
 * The assertion carries `aud: serverHost`, which is what stops it being replayed
 * at a different server. That host arrives in the server's challenge, so signing
 * it unchecked means signing an audience the other end chose — and a server that
 * names a *different* host gets the client to mint an assertion valid somewhere
 * it never meant to authenticate.
 *
 * So the client compares the claimed host against the one it actually dialled
 * and refuses when they differ.
 */

/**
 * Normalises a `host` or `host:port` for comparison.
 *
 * Deliberately conservative — it only removes differences that are genuinely
 * meaningless: case, surrounding whitespace, and the trailing dot of a fully
 * qualified name (`dev-412.local.` is the same host as `dev-412.local`). Ports
 * are kept, because a different port really is a different endpoint. IPv6
 * literals keep their brackets.
 */
export function normalizeHostForComparison(value: string): string {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) return "";

  // Split host from port without tripping over IPv6 literals, where the colons
  // inside the brackets are part of the address.
  const lastColon = trimmed.lastIndexOf(":");
  const closingBracket = trimmed.lastIndexOf("]");
  const hasPort = lastColon !== -1 && lastColon > closingBracket;

  const host = hasPort ? trimmed.slice(0, lastColon) : trimmed;
  const port = hasPort ? trimmed.slice(lastColon) : "";

  return `${host.replace(/\.$/, "")}${port}`;
}

/**
 * True when the host named in a challenge is the host we connected to.
 *
 * An empty or missing value never matches: a server that omits the host does not
 * get to skip the check.
 */
export function challengeHostMatches(
  dialledHost: string,
  claimedHost: string,
): boolean {
  const dialled = normalizeHostForComparison(dialledHost);
  const claimed = normalizeHostForComparison(claimedHost);

  return dialled.length > 0 && dialled === claimed;
}
