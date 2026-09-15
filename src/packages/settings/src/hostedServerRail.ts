import { normalizeHost } from "@gryt/core";

// Type-only, so scripts/check-hosted-server-rail.mjs can import this module in Node.
import type { EmbeddedServerState } from "../../../lib/electron";
import { sameServer, socketServerId } from "./serverId.ts";
import type { Servers } from "./types/server";

/**
 * Every rail entry for a server this machine hosts, at any address. Matched on the
 * stored id, plus the loopback address, which is this server whatever id it holds.
 */
export function railEntriesFor(
  server: EmbeddedServerState,
  joined: Servers,
): string[] {
  const hosts = new Set<string>();

  const config = server.config;
  if (config) {
    const own = {
      host: `127.0.0.1:${config.serverPort}`,
      serverId: socketServerId(config.serverName, config.serverPort, server.id),
    };
    for (const [host, entry] of Object.entries(joined)) {
      if (sameServer(own, { host, serverId: entry.serverId })) hosts.add(host);
    }
  }

  const loopback = server.serverUrl ? normalizeHost(server.serverUrl) : "";
  if (loopback && joined[loopback]) hosts.add(loopback);

  return [...hosts];
}

/**
 * The rail entries of every server running now that was something else when last seen.
 * One never seen before is left out, since nothing says it has only just come up.
 */
export function railEntriesJustStarted(
  lastSeen: ReadonlyMap<string, string>,
  now: EmbeddedServerState[],
  joined: Servers,
): string[] {
  const hosts = new Set<string>();

  for (const server of now) {
    const before = lastSeen.get(server.id);
    if (server.status !== "running" || before === undefined || before === "running") continue;
    for (const host of railEntriesFor(server, joined)) hosts.add(host);
  }

  return [...hosts];
}
