import { Button, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { useSockets } from "../hooks/useSockets";

type Role = "owner" | "admin" | "mod" | "member";

export function ServerRolesTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const { memberLists, requestMemberList } = useSockets();
  const members = host ? (memberLists[host] || []) : [];

  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:roles:list", { accessToken });
    requestMemberList(host);
  };

  useSocketEvent<{ roles: { serverUserId: string; role: Role }[] }>(socket, "server:roles", (payload) => {
    const map: Record<string, Role> = {};
    (payload?.roles || []).forEach((r) => {
      if (r?.serverUserId) map[r.serverUserId] = r.role;
    });
    setRoles(map);
  });

  useSocketEvent<{ serverUserId: string; role: Role }>(socket, "server:role:updated", (payload) => {
    if (!payload?.serverUserId) return;
    setRoles((prev) => ({ ...prev, [payload.serverUserId]: payload.role }));
    // The real confirmation, in place of the one that used to fire before the
    // server had said anything.
    toast.success(`Role set to ${payload.role}.`);
  });

  useEffect(() => {
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  const setRole = (serverUserId: string, role: Role) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    setSubmitting(true);
    try {
      // No success toast here. It used to fire unconditionally, before any
      // acknowledgement, so the owner-only and self-change cases the server
      // rejects still reported "Role updated". server:role:updated below is
      // the actual confirmation; a refusal arrives as server:error.
      socket.emit("server:roles:set", { accessToken, serverUserId, role });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm text-gryt-muted">
        Owners can assign roles to members. Admins can manage invites/channels and view the audit log.
      </span>

      <div className="flex justify-end gap-2">
        <Button tone="neutral" size="small" onClick={refresh} disabled={submitting}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {members.length === 0 ? (
          <span className="text-sm text-gryt-muted">
            No members found.
          </span>
        ) : (
          members.map((m) => {
            const r = roles[m.serverUserId] || "member";
            return (
              <Surface key={m.serverUserId}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">
                      {m.nickname}
                    </span>
                    <span className="text-xs text-gryt-muted">
                      ID: {m.serverUserId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gryt-muted">
                      Role
                    </span>
                    <select
                      value={r}
                      onChange={(e) => setRole(m.serverUserId, (e.target.value as Role) || "member")}
                      disabled={submitting || r === "owner"}
                    >
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="mod">mod</option>
                      <option value="member">member</option>
                    </select>
                  </div>
                </div>
              </Surface>
            );
          })
        )}
      </div>
    </div>
  );
}

