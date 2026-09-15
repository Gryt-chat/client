import { normalizeHost } from "@gryt/core";

// Type-only, so scripts/check-hosted-server-rail.mjs can import this module in Node.
import type { EmbeddedServerState } from "../../../lib/electron";
import type { Servers } from "./types/server";

/** Letters and digits only. The server lowercases the name and turns spaces into underscores. */
function comparableName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** The port a rail key names, or null when the address has none. */
function portOf(host: string): number | null {
  const match = /^(?:\[[^\]]*\]|[^:]*):(\d+)$/.exec(host);
  return match ? Number(match[1]) : null;
}

/**
 * The socket reports `name_port_instanceId` and /info the bare instance id. That one
 * carries no port, so the port has to come from the address it was joined at.
 */
function isThisServer(
  server: EmbeddedServerState,
  host: string,
  serverId: string,
): boolean {
  const config = server.config;
  if (!config) return false;

  if (serverId === server.id) return portOf(host) === config.serverPort;

  const suffix = `_${config.serverPort}_${server.id}`;
  if (!serverId.endsWith(suffix)) return false;
  return (
    comparableName(serverId.slice(0, -suffix.length)) ===
    comparableName(config.serverName)
  );
}

/**
 * Every rail entry for a server this machine hosts, at any address. Matched on the
 * stored id, plus the loopback address, which is this server whatever id it holds.
 */
export function railEntriesFor(
  server: EmbeddedServerState,
  joined: Servers,
): string[] {
  const hosts = new Set<string>();

  for (const [host, entry] of Object.entries(joined)) {
    if (entry.serverId && isThisServer(server, host, entry.serverId)) {
      hosts.add(host);
    }
  }

  const loopback = server.serverUrl ? normalizeHost(server.serverUrl) : "";
  if (loopback && joined[loopback]) hosts.add(loopback);

  return [...hosts];
}
