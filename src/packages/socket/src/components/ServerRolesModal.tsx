import { Button, Dialog, IconButton, Surface } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PiX } from "react-icons/pi";

import { getServerAccessToken } from "@/common";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { useSockets } from "../hooks/useSockets";

type OpenDetail = { host: string };

type Role = "owner" | "admin" | "mod" | "member";

export function ServerRolesModal() {
  const { sockets, memberLists, requestMemberList } = useSockets();

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState("");
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [submitting, setSubmitting] = useState(false);

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);
  const accessToken = useMemo(() => (host ? getServerAccessToken(host) : null), [host]);
  const members = host ? (memberLists[host] || []) : [];

  useEffect(() => {
    const handler = (event: CustomEvent<OpenDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setIsOpen(true);
    };
    window.addEventListener("server_roles_open", handler as EventListener);
    return () => window.removeEventListener("server_roles_open", handler as EventListener);
  }, []);

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
  });

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, host, socket?.connected]);

  const close = () => {
    if (submitting) return;
    setIsOpen(false);
    setHost("");
    setRoles({});
  };

  const setRole = (serverUserId: string, role: Role) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    setSubmitting(true);
    try {
      socket.emit("server:roles:set", { accessToken, serverUserId, role });
      toast.success("Role updated");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 760 }}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Dialog.Title>Roles</Dialog.Title>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall" onClick={close} disabled={submitting}>
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

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
              <span className="text-sm text-gryt-muted">No members found.</span>
            ) : (
              members.map((m) => {
                const r = roles[m.serverUserId] || "member";
                return (
                  <Surface key={m.serverUserId}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold">{m.nickname}</span>
                        <span className="text-xs text-gryt-muted">ID: {m.serverUserId}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gryt-muted">Role</span>
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
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

