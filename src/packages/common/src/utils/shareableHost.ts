/**
 * Which address an invite to a locally hosted server should name (GRYT-135).
 *
 * The invite dialog builds its link from whatever address the client is
 * connected on. For a server started from the desktop app that is
 * `127.0.0.1:<port>`, so the link tells whoever receives it to connect to their
 * own machine. It is a valid address and it is the wrong computer, which is the
 * worst shape a broken link can take: nothing errors, it just does not find the
 * server, and the person who sent it has no reason to suspect the link.
 *
 * Since GRYT-277 an embedded server knows the addresses it advertises, so there
 * is usually something better to name. Where there is not, the honest answer is
 * to say so rather than hand somebody a link that cannot work.
 */

/**
 * Bare host with any port removed, lowercased, brackets stripped.
 *
 * The bracket form is handled first and on its own, because an IPv6 address is
 * mostly colons and a blanket "strip `:<digits>` from the end" turns `::1` into
 * `:`. Outside brackets, a colon is only a port separator when there is exactly
 * one of them — `192.168.1.1:5001` has a port, `::1` does not.
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
 * Whether this address only means anything on the machine that used it.
 *
 * The whole 127/8 block, not just 127.0.0.1: `127.0.0.2` is just as loopback
 * and turns up when somebody has bound a second service locally.
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
 * Pick the address to put in an invite.
 *
 * Anything that is not loopback is already shareable and is returned unchanged.
 * That covers every server somebody joined by address, which is most of them,
 * and means this cannot make an ordinary invite worse.
 *
 * For a loopback address, the host's own typed-in addresses come first. Somebody
 * who went to Settings and entered a public IP was answering exactly this
 * question, and their answer beats anything detected. Detected addresses come
 * next, which are the machine's LAN addresses: not reachable from the internet,
 * but correct for the case an embedded server is usually used for, which is
 * people in the same building.
 *
 * One address rather than several, because the invite format carries one host.
 * Offering a choice would mean changing that format and every parser of it.
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
  // port to them. An invite needs the address people connect to, which is the
  // server's.
  const bare = candidate.trim();
  const needsBrackets = bare.includes(":") && !bare.startsWith("[");
  return {
    kind: "ok",
    host: `${needsBrackets ? `[${bare}]` : bare}:${server.serverPort}`,
  };
}
