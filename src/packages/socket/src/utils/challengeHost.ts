/**
 * Guards the audience of an identity assertion. The host arrives in the server's
 * challenge, so signing it unchecked signs an audience the other end chose.
 */

/**
 * Normalises a `host` or `host:port` for comparison. Case, whitespace and a
 * trailing dot only. Ports are kept; IPv6 literals keep their brackets.
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
 * True when the host named in a challenge is the host we connected to. An empty
 * value never matches: omitting the host does not skip the check.
 */
export function challengeHostMatches(
  dialledHost: string,
  claimedHost: string,
): boolean {
  const dialled = normalizeHostForComparison(dialledHost);
  const claimed = normalizeHostForComparison(claimedHost);

  return dialled.length > 0 && dialled === claimed;
}
