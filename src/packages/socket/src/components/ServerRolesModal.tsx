import { X as Cross2Icon } from "lucide-react";
import { Button, Card,Dialog, Flex, IconButton, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

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

  useEffect(() => {
    if (!socket) return;
    const onRoles = (payload: { roles: { serverUserId: string; role: Role }[] }) => {
      const map: Record<string, Role> = {};
      (payload?.roles || []).forEach((r) => {
        if (r?.serverUserId) map[r.serverUserId] = r.role;
      });
      setRoles(map);
    };
    const onRoleUpdated = (payload: { serverUserId: string; role: Role }) => {
      if (!payload?.serverUserId) return;
      setRoles((prev) => ({ ...prev, [payload.serverUserId]: payload.role }));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:roles", onRoles as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:role:updated", onRoleUpdated as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:roles", onRoles as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:role:updated", onRoleUpdated as any);
    };
  }, [socket]);

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
      <Dialog.Content style={{ maxWidth: 760 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Dialog.Title>Roles</Dialog.Title>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={close} disabled={submitting}>
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>

          <Text size="2" color="gray">
            Owners can assign roles to members. Admins can manage invites/channels and view the audit log.
          </Text>

          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={refresh} disabled={submitting}>
              Refresh
            </Button>
          </Flex>

          <Flex direction="column" gap="2">
            {members.length === 0 ? (
              <Text size="2" color="gray">No members found.</Text>
            ) : (
              members.map((m) => {
                const r = roles[m.serverUserId] || "member";
                return (
                  <Card key={m.serverUserId}>
                    <Flex align="center" justify="between" gap="2" wrap="wrap">
                      <Flex direction="column" gap="1">
                        <Text size="2" weight="bold">{m.nickname}</Text>
                        <Text size="1" color="gray">ID: {m.serverUserId}</Text>
                      </Flex>
                      <Flex align="center" gap="2">
                        <Text size="2" color="gray">Role</Text>
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
                      </Flex>
                    </Flex>
                  </Card>
                );
              })
            )}
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

