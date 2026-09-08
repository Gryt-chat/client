/**
 * Which address an invite to a locally hosted server should name. Built from the
 * connected address, that is `127.0.0.1` and points at the reader (GRYT-135).
 */

/**
 * Bare host with any port removed, lowercased, brackets stripped. The bracket
 * form goes first: a blanket strip of `:<digits>` turns `::1` into `:`.
 */
function hostname(host: string): string {
  const trimmed = host.trim();

  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return bracketed[1].toLowerCase();

  const withoutPort =
    (trimmed.match(/:/g) || []).length === 1
      ? trimmed.replace(/:\d+$/, "")
      : trimmed;

  return withoutPort.toLowerCase();
}

/**
 * Whether this address only means anything on the machine that used it. The whole
 * 127/8 block, not just 127.0.0.1.
 */
export function isLoopbackHost(host: string): boolean {
  const name = hostname(host);
  return (
    name === "localhost" ||
    name === "::1" ||
    name.endsWith(".localhost") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)
  );
}

/** What an embedded server knows about how it can be reached. */
export interface AdvertisedServer {
  serverPort: number;
  /** Detected on this machine, so LAN addresses. */
  advertisedAddresses: string[];
  /** Typed in by the host, so a public IP or hostname they meant. */
  customAdvertisedAddresses: string[];
}

export type ShareableHost =
  /** Use this address in the link. */
  | { kind: "ok"; host: string }
  /**
   * The address is loopback and nothing better is known. The caller should
   * refuse rather than produce a link, and say what would fix it.
   */
  | { kind: "loopback-only" };

/**
 * Pick the address to put in an invite. Anything not loopback is returned
 * unchanged; for loopback, typed-in addresses beat detected LAN ones.
 */
export function pickShareableHost(
  host: string,
  server: AdvertisedServer | null | undefined,
): ShareableHost {
  if (!isLoopbackHost(host)) return { kind: "ok", host };
  if (!server) return { kind: "loopback-only" };

  const candidate =
    server.customAdvertisedAddresses.find((a) => a.trim() && !isLoopbackHost(a)) ??
    server.advertisedAddresses.find((a) => a.trim() && !isLoopbackHost(a));

  if (!candidate) return { kind: "loopback-only" };

  // The advertised list holds bare addresses, because the SFU appends its own
  // port. An invite needs the address people connect to, which is the server's.
  const bare = candidate.trim();
  const needsBrackets = bare.includes(":") && !bare.startsWith("[");
  return {
    kind: "ok",
    host: `${needsBrackets ? `[${bare}]` : bare}:${server.serverPort}`,
  };
}
