/* A type-only import so scripts/check-server-order.mjs can import this module:
   a value import would send Node looking for an extensionless file. */
import type { Servers } from "./types/server";

/**
 * The rail's order: what the user dragged, then whatever they have not. Its own
 * module because the rail renders it and the launch focus opens the first of it.
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
