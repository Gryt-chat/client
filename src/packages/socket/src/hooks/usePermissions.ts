import { useMemo } from "react";

import { canInChannel, PERMISSIONS_BEFORE_CATALOGUE } from "../lib/permissions";
import { useSockets } from "./useSockets";

export type ServerRoleSummary = {
  id: string;
  name: string;
  color: string | null;
  rank: number;
  permissions: string[];
  isSystem: boolean;
};

/** The hook's `can` below, for any server and outside a component: the direct
    messages space asks it of every server at once. */
export function canOnServer(
  info: { permissions?: string[]; permission_catalogue?: string[] } | undefined,
  permission: string,
): boolean {
  if (!Array.isArray(info?.permissions)) return true;
  if (info.permissions.includes(permission)) return true;
  const catalogue = Array.isArray(info.permission_catalogue)
    ? info.permission_catalogue
    : PERMISSIONS_BEFORE_CATALOGUE;
  return !catalogue.includes(permission);
}

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

  const channels = host ? serverDetailsList[host]?.channels : undefined;
  const channelById = useMemo(
    () => new Map((channels ?? []).map((c) => [c.id, c])),
    [channels],
  );

  const roles = useMemo<ServerRoleSummary[]>(
    () => (info?.roles ?? []) as ServerRoleSummary[],
    [info?.roles],
  );

  return useMemo(() => {
    const can = (permission: string) =>
      !known || permissions.has(permission) || !serverKnows.has(permission);
    return {
      can,
      /** `can`, in one conversation. A DM or an id the server did not list gets
          the server-wide answer. */
      canIn: (conversationId: string | null | undefined, permission: string) =>
        canInChannel(conversationId ? channelById.get(conversationId) : undefined, can, permission),
      /** False unless the server actually said so. For "is this a guest". */
      has: (permission: string) => permissions.has(permission),
      known,
      permissions,
      roles,
      roleId: info?.role,
      role: roles.find((r) => r.id === info?.role),
      isOwner: Boolean(info?.is_owner),
    };
  }, [known, permissions, serverKnows, channelById, roles, info?.role, info?.is_owner]);
}
