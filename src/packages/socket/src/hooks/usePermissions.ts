import { useMemo } from "react";

import { PERMISSIONS_BEFORE_CATALOGUE } from "../lib/permissions";
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
 * What this client may do on one server, and what the roles are called. `can`
 * answers true where the server has not said no — the server is enforcing it.
 */
export function useServerPermissions(host: string) {
  const { serverDetailsList } = useSockets();
  const info = host ? serverDetailsList[host]?.server_info : undefined;

  const list = info?.permissions;
  const permissions = useMemo(() => new Set(list ?? []), [list]);
  const known = Array.isArray(list);

  const catalogue = info?.permission_catalogue;
  const serverKnows = useMemo(
    () =>
      new Set(
        Array.isArray(catalogue) ? catalogue : PERMISSIONS_BEFORE_CATALOGUE,
      ),
    [catalogue],
  );

  const roles = useMemo<ServerRoleSummary[]>(
    () => (info?.roles ?? []) as ServerRoleSummary[],
    [info?.roles],
  );

  return useMemo(
    () => ({
      can: (permission: string) =>
        !known || permissions.has(permission) || !serverKnows.has(permission),
      /** False unless the server actually said so. For "is this a guest". */
      has: (permission: string) => permissions.has(permission),
      known,
      permissions,
      roles,
      roleId: info?.role,
      role: roles.find((r) => r.id === info?.role),
      isOwner: Boolean(info?.is_owner),
    }),
    [known, permissions, serverKnows, roles, info?.role, info?.is_owner],
  );
}
