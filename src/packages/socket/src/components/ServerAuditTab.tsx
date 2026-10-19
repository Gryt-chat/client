import { Button, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { describeActor } from "../lib/actorName";

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
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        <Button tone="neutral" size="small" onClick={refresh}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <span className="text-sm text-gryt-muted">
            No audit entries.
          </span>
        ) : (
          items.map((it) => (
            <Surface key={it.eventId}>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold">
                  {it.action}
                  {it.target ? ` · ${it.target}` : ""}
                </span>
                <span className="text-xs text-gryt-muted">
                  {fmt(it.createdAt)} · by {describeActor(it.actorServerUserId).label}
                </span>
                {it.meta ? (
                  <span className="text-xs text-gryt-muted" style={{ whiteSpace: "pre-wrap" }}>
                    {typeof it.meta === "string" ? it.meta : JSON.stringify(it.meta, null, 2)}
                  </span>
                ) : null}
              </div>
            </Surface>
          ))
        )}
      </div>
    </div>
  );
}

