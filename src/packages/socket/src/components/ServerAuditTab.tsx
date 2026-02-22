import { Button, Card, Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

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

export function ServerAuditTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: { connected: boolean; emit: (event: string, data: unknown) => void; on: (event: string, handler: (...args: unknown[]) => void) => void; off: (event: string, handler: (...args: unknown[]) => void) => void };
  accessToken: string | null;
}) {
  const [items, setItems] = useState<AuditItem[]>([]);

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
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  return (
    <Flex direction="column" gap="4">
      <Flex justify="end" gap="2">
        <Button variant="soft" color="gray" onClick={refresh}>
          Refresh
        </Button>
      </Flex>

      <Flex direction="column" gap="2">
        {items.length === 0 ? (
          <Text size="2" color="gray">
            No audit entries.
          </Text>
        ) : (
          items.map((it) => (
            <Card key={it.eventId}>
              <Flex direction="column" gap="1">
                <Text size="2" weight="bold">
                  {it.action}
                  {it.target ? ` · ${it.target}` : ""}
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
  );
}

