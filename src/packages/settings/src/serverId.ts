import { normalizeHost } from "@gryt/core";

/** One server as a rail entry or an /info lookup knows it: the address, and the id it gave there. */
export interface ServerRef {
  host: string;
  serverId?: string | null;
}

/** The id a server's socket reports, built the way `computeServerId` builds it in the server. */
export function socketServerId(serverName: string, port: number, instanceId: string): string {
  return `${serverName.replace(/\s+/g, "_").toLowerCase()}_${port}_${instanceId}`;
}

/** The port an address names, or null when it has none. */
function portOf(host: string): number | null {
  const match = /^(?:\[[^\]]*\]|[^:]*):(\d+)$/.exec(normalizeHost(host));
  return match ? Number(match[1]) : null;
}

/** Whether `id` is the socket's `name_port_instanceId` for the instance id /info gave at `info.host`. */
function isSocketIdFor(id: string, info: { host: string; serverId: string }): boolean {
  const port = portOf(info.host);
  if (port === null) return false;

  const suffix = `_${port}_${info.serverId}`;
  return id.length > suffix.length && id.endsWith(suffix);
}

/**
 * Whether two refs are one server. /info gives the bare instance id and the socket gives
 * `name_port_instanceId`, so those two match only when /info's address has that port.
 */
export function sameServer(a: ServerRef, b: ServerRef): boolean {
  if (!a.serverId || !b.serverId) return false;
  if (a.serverId === b.serverId) return true;

  return (
    isSocketIdFor(a.serverId, { host: b.host, serverId: b.serverId }) ||
    isSocketIdFor(b.serverId, { host: a.host, serverId: a.serverId })
  );
}
