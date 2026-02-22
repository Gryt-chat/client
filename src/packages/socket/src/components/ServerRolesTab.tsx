import { Button, Card, Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useSockets } from "../hooks/useSockets";

type Role = "owner" | "admin" | "mod" | "member";

export function ServerRolesTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: { connected: boolean; emit: (event: string, data: unknown) => void; on: (event: string, handler: (...args: unknown[]) => void) => void; off: (event: string, handler: (...args: unknown[]) => void) => void };
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
      socket.emit("server:roles:set", { accessToken, serverUserId, role });
      toast.success("Role updated");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Flex direction="column" gap="4">
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
          <Text size="2" color="gray">
            No members found.
          </Text>
        ) : (
          members.map((m) => {
            const r = roles[m.serverUserId] || "member";
            return (
              <Card key={m.serverUserId}>
                <Flex align="center" justify="between" gap="2" wrap="wrap">
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="bold">
                      {m.nickname}
                    </Text>
                    <Text size="1" color="gray">
                      ID: {m.serverUserId}
                    </Text>
                  </Flex>
                  <Flex align="center" gap="2">
                    <Text size="2" color="gray">
                      Role
                    </Text>
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
  );
}

