/* A type-only import so this module can be imported by scripts/check-server-order.mjs.
   Node strips types on import and never resolves the specifier; a value import
   would send it looking for an extensionless file. */
import type { Servers } from "./types/server";

/**
 * The rail's order: what the user dragged, then whatever they have not.
 *
 * `serverOrder` only lists hosts that have been dragged at least once, and it
 * goes on listing hosts that have since been removed, so neither list is usable
 * on its own. Anything the order does not name keeps its position in the
 * servers map, which is the order those servers were added in.
 *
 * Its own module because two callers in two different hooks need the same
 * answer: the rail renders this, and the launch focus opens the first of it.
 */
export function orderServerHosts(
  servers: Servers,
  serverOrder: string[]
): string[] {
  const allHosts = Object.keys(servers);
  const ordered = serverOrder.filter((host) => allHosts.includes(host));

  for (const host of allHosts) {
    if (!ordered.includes(host)) ordered.push(host);
  }

  return ordered;
}
