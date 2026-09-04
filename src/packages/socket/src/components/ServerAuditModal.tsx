import { Button, Dialog, IconButton, Surface } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

import { PiX } from "../../../../lib/icons";
import { useSocketEvent } from "../hooks/useSocketEvent";
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

  useSocketEvent<{ items: AuditItem[] }>(socket, "server:audit", (payload) => {
    setItems(Array.isArray(payload?.items) ? payload.items : []);
  });

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
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 860 }}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Dialog.Title>Audit log</Dialog.Title>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall" onClick={close}>
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

          <div className="flex justify-end gap-2">
            <Button tone="neutral" size="small" onClick={refresh}>
              Refresh
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {items.length === 0 ? (
              <span className="text-sm text-gryt-muted">No audit entries.</span>
            ) : (
              items.map((it) => (
                <Surface key={it.eventId}>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">
                      {it.action}{it.target ? ` · ${it.target}` : ""}
                    </span>
                    <span className="text-xs text-gryt-muted">
                      {fmt(it.createdAt)} · actor: {it.actorServerUserId || "system"}
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
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

