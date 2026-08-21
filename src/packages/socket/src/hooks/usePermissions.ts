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
 * What this client may do on one server, and what the roles there are called.
 *
 * Both arrive on `server:details` and are refreshed whenever the server
 * rebroadcasts it, which it does on every role change — so a demotion takes
 * effect in the UI without a reconnect.
 *
 * `can` answers true in the two cases where the server has not actually said
 * no. One is a server that sent no permission list at all — older than this
 * feature entirely. The other is a permission missing from the server's own
 * catalogue, which means that build has never heard of it and therefore cannot
 * be withholding it. Both used to read as a denial, and the second is worse
 * than it sounds: a client that learns about `read_messages` before its server
 * does would blank out every channel on it.
 *
 * The server is the one enforcing this. The client is only deciding what to
 * offer, so leaning towards offering is the safe direction — the refusal comes
 * back as an error rather than as a wrong answer.
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
