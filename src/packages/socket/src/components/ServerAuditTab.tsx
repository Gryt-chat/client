import { Button, Surface } from "@gryt/ui";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";

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
  socket?: Socket;
  accessToken: string | null;
}) {
  const [items, setItems] = useState<AuditItem[]>([]);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:audit:list", { accessToken, limit: 100 });
  };

  useSocketEvent<{ items: AuditItem[] }>(socket, "server:audit", (payload) => {
    setItems(Array.isArray(payload?.items) ? payload.items : []);
  });

  useEffect(() => {
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  return (
    <Flex direction="column" gap="4">
      <Flex justify="end" gap="2">
        <Button tone="neutral" size="small" onClick={refresh}>
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
            <Surface key={it.eventId}>
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
            </Surface>
          ))
        )}
      </Flex>
    </Flex>
  );
}

