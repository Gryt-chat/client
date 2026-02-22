import { Cross2Icon } from "@radix-ui/react-icons";
import { Button, Card,Dialog, Flex, IconButton, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

import { useSockets } from "../hooks/useSockets";

type OpenDetail = { host: string };

type AuditItem = {
  createdAt: string | Date;
  eventId: string;
  actorServerUserId: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | string | null;
};

function fmt(v: string | Date): string {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : String(v || "");
}

export function ServerAuditModal() {
  const { sockets } = useSockets();

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState("");
  const [items, setItems] = useState<AuditItem[]>([]);

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);
  const accessToken = useMemo(() => (host ? getServerAccessToken(host) : null), [host]);

  useEffect(() => {
    const handler = (event: CustomEvent<OpenDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setIsOpen(true);
    };
    window.addEventListener("server_audit_open", handler as EventListener);
    return () => window.removeEventListener("server_audit_open", handler as EventListener);
  }, []);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:audit:list", { accessToken, limit: 100 });
  };

  useEffect(() => {
    if (!socket) return;
    const onAudit = (payload: { items: AuditItem[] }) => {
      setItems(Array.isArray(payload?.items) ? payload.items : []);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:audit", onAudit as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:audit", onAudit as any);
    };
  }, [socket]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, host, socket?.connected]);

  const close = () => {
    setIsOpen(false);
    setHost("");
    setItems([]);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : close())}>
      <Dialog.Content style={{ maxWidth: 860 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Dialog.Title>Audit log</Dialog.Title>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={close}>
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>

          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={refresh}>
              Refresh
            </Button>
          </Flex>

          <Flex direction="column" gap="2">
            {items.length === 0 ? (
              <Text size="2" color="gray">No audit entries.</Text>
            ) : (
              items.map((it) => (
                <Card key={it.eventId}>
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="bold">
                      {it.action}{it.target ? ` · ${it.target}` : ""}
                    </Text>
                    <Text size="1" color="gray">
                      {fmt(it.createdAt)} · actor: {it.actorServerUserId || "system"}
                    </Text>
                    {it.meta ? (
                      <Text size="1" color="gray" style={{ whiteSpace: "pre-wrap" }}>
                        {typeof it.meta === "string" ? it.meta : JSON.stringify(it.meta, null, 2)}
                      </Text>
                    ) : null}
                  </Flex>
                </Card>
              ))
            )}
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

