/**
 * Which address an invite to a locally hosted server should name. Built from the
 * connected address, that is `127.0.0.1` and points at the reader (GRYT-135).
 */

import { normalizeHost } from "@gryt/core";

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

/** Names that only mean something on one network. A bare name with no dot is one too. */
const LOCAL_SUFFIXES = ["localhost", "local", "localdomain", "lan", "home", "internal", "home.arpa"];

/** Lowercased, with any port, brackets and trailing dot removed. */
function bareHostname(host: string): string {
  const trimmed = normalizeHost(host).toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return bracketed[1];
  const colons = (trimmed.match(/:/g) || []).length;
  const withoutPort = colons === 1 ? trimmed.replace(/:\d*$/, "") : trimmed;
  return withoutPort.replace(/\.$/, "");
}

function ipv4Octets(name: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return null;
  const octets = name.split(".").map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function isPublicIpv4([a, b]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT, and Tailscale
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  return !(a === 192 && b === 168);
}

/**
 * Whether an address works for somebody on another network. A copy of core's
 * `isPublicHost` until the release is pinned (GRYT-1300).
 */
export function isPublicHost(host: string): boolean {
  const name = bareHostname(host);
  if (!name) return false;

  const v4 = ipv4Octets(name);
  if (v4) return isPublicIpv4(v4);

  if (name.includes(":")) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(name);
    if (mapped) {
      const octets = ipv4Octets(mapped[1]);
      return !!octets && isPublicIpv4(octets);
    }
    if (name === "::" || name === "::1") return false;
    // fc00::/7 is private, fe80::/10 is link-local.
    return !/^f[cd]/.test(name) && !/^fe[89ab]/.test(name);
  }

  // No top-level domain is all digits, so `999.1.1.1` is a broken address rather than a name.
  if (!name.includes(".") || /\.\d+$/.test(name)) return false;
  return !LOCAL_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

/**
 * The address a link to an open server should name. Unlike an invite, a LAN address won't
 * do: the link is for anyone, and the only addresses known to be public are typed-in ones.
 */
export function pickPublicHost(
  host: string,
  server: AdvertisedServer | null | undefined,
): { kind: "ok"; host: string } | { kind: "none" } {
  if (isPublicHost(host)) return { kind: "ok", host };
  if (!server) return { kind: "none" };

  const typed = server.customAdvertisedAddresses.map((a) => a.trim()).find(isPublicHost);
  if (!typed) return { kind: "none" };

  const needsBrackets = typed.includes(":") && !typed.startsWith("[");
  return { kind: "ok", host: `${needsBrackets ? `[${typed}]` : typed}:${server.serverPort}` };
}
