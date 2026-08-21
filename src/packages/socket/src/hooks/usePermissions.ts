import { useMemo } from "react";

import { useSockets } from "./useSockets";

export type ServerRoleSummary = {
  id: string;
  name: string;
  color: string | null;
  rank: number;
  permissions: string[];
  isSystem: boolean;
};

/**
 * What this client may do on one server, and what the roles there are called.
 *
 * Both arrive on `server:details` and are refreshed whenever the server
 * rebroadcasts it, which it does on every role change — so a demotion takes
 * effect in the UI without a reconnect.
 *
 * `can` answers true for a server that sent no permission list at all. That is
 * a server older than this feature, and treating silence as "you may do
 * nothing" would leave the client refusing to render its own compose box
 * against every server that has not been upgraded yet. The server is the one
 * enforcing this; the client is only deciding what to offer.
 */
export function useServerPermissions(host: string) {
  const { serverDetailsList } = useSockets();
  const info = host ? serverDetailsList[host]?.server_info : undefined;

  const list = info?.permissions;
  const permissions = useMemo(() => new Set(list ?? []), [list]);
  const known = Array.isArray(list);

  const roles = useMemo<ServerRoleSummary[]>(
    () => (info?.roles ?? []) as ServerRoleSummary[],
    [info?.roles],
  );

  return useMemo(
    () => ({
      can: (permission: string) => !known || permissions.has(permission),
      /** False unless the server actually said so. For "is this a guest". */
      has: (permission: string) => permissions.has(permission),
      known,
      permissions,
      roles,
      roleId: info?.role,
      role: roles.find((r) => r.id === info?.role),
      isOwner: Boolean(info?.is_owner),
    }),
    [known, permissions, roles, info?.role, info?.is_owner],
  );
}
