import { Button, Surface, Switch, TextField } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PiCopyFill, PiPlus } from "react-icons/pi";
import type { Socket } from "socket.io-client";

import { isLoopbackHost, pickShareableHost } from "@/common";
import { useEmbeddedServer } from "@/settings/src/hooks/useEmbeddedServer";

import { useSocketEvent } from "../hooks/useSocketEvent";

export type InviteItem = {
  code: string;
  createdAt?: string | Date;
  expiresAt?: string | Date | null;
  maxUses?: number;
  usesRemaining?: number;
  usesConsumed?: number;
  revoked?: boolean;
  note?: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isInviteItem(v: unknown): v is InviteItem {
  if (!isRecord(v)) return false;
  return typeof v.code === "string" && v.code.trim().length > 0;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatExpiry(d: Date | null): string {
  if (!d) return "Never";
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatUses(remaining: number | undefined, max: number | undefined): string {
  const isInfinite = typeof max === "number" && max < 0;
  if (isInfinite) return "∞";
  if (remaining === undefined) return "?";
  if (typeof max === "number") return `${remaining} / ${max}`;
  return String(remaining);
}

export function ServerInvitesTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const { servers: embeddedServers } = useEmbeddedServer();

  /* Roles an invite may be bound to. The server decides which those are — the
     flag is off for every role until somebody ticks it, and admin, owner and
     anything that can hand out permissions are refused outright. So this list
     is whatever came back already filtered, not a judgement made here. An empty
     list means the picker does not appear, which is the honest thing to show
     somebody who has not marked any role as invite-grantable. */
  const [grantableRoles, setGrantableRoles] = useState<
    { id: string; name: string }[]
  >([]);
  const [grantsRole, setGrantsRole] = useState("");

  useEffect(() => {
    if (!socket || !accessToken) return;
    socket.emit("server:roles:definitions:list", { accessToken });
  }, [socket, accessToken]);

  useSocketEvent<{
    roles?: { id: string; name: string; grantableByInvite?: boolean }[];
  }>(socket, "server:roles:definitions", (payload) => {
    setGrantableRoles(
      (payload?.roles ?? [])
        .filter((r) => r.grantableByInvite)
        .map((r) => ({ id: r.id, name: r.name })),
    );
  });

  /* The embedded server this host is, if it is one. Matched on the port it
     answers on, since a locally hosted server is only ever reached over
     loopback and the port is what tells two of them apart. */
  const advertised = useMemo(() => {
    if (!isLoopbackHost(host)) return null;
    const port = Number(host.split(":").pop());
    if (!Number.isFinite(port)) return null;
    return (
      embeddedServers.find((s) => s.config?.serverPort === port)?.config ?? null
    );
  }, [host, embeddedServers]);

  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [maxUses, setMaxUses] = useState<string>("1");
  const [infiniteUses, setInfiniteUses] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [customCode, setCustomCode] = useState<string>("");
  const [, setTick] = useState(0);

  useEffect(() => {
    const hasExpiring = invites.some((i) => !i.revoked && i.expiresAt);
    if (!hasExpiring) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [invites]);

  const refresh = async () => {
    if (!socket || !socket.connected) {
      toast.error("Not connected to the server yet.");
      return;
    }
    if (!accessToken) {
      toast.error("Join the server first.");
      return;
    }
    setLoading(true);
    try {
      socket.emit("server:invites:list", { accessToken });
    } finally {
      setLoading(false);
    }
  };

  useSocketEvent<unknown>(socket, "server:invites", (payload) => {
    const raw = isRecord(payload) ? payload.invites : undefined;
    const items = Array.isArray(raw) ? raw.filter(isInviteItem) : [];
    setInvites(items);
  });

  useSocketEvent<unknown>(socket, "server:invite:created", (payload) => {
    const raw = isRecord(payload) ? payload.invite : undefined;
    if (!isInviteItem(raw)) return;
    setInvites((prev) => [raw, ...prev.filter((p) => p.code !== raw.code)]);
    toast.success("Invite created");
  });

  useSocketEvent<unknown>(socket, "server:invite:revoked", (payload) => {
    if (!isRecord(payload)) return;
    const code = payload.code;
    const revoked = payload.revoked;
    if (typeof code !== "string" || typeof revoked !== "boolean") return;
    setInvites((prev) => prev.map((i) => (i.code === code ? { ...i, revoked } : i)));
  });

  useEffect(() => {
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  const create = async () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");

    const mu = Math.max(1, Math.min(1000, parseInt(maxUses || "1", 10) || 1));
    const ehRaw = expiresInHours.trim();
    const eh = ehRaw.length ? (parseFloat(ehRaw) || 0) : undefined;

    const cc = customCode.trim().toLowerCase();

    setCreating(true);
    try {
      socket.emit("server:invites:create", {
        accessToken,
        ...(infiniteUses ? { infinite: true } : { maxUses: mu }),
        expiresInHours: typeof eh === "number" && eh > 0 ? eh : undefined,
        note: note.trim().length ? note.trim() : null,
        customCode: cc.length ? cc : null,
        grantsRole: grantsRole || null,
      });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:invites:revoke", { accessToken, code });
  };

  const copy = async (code: string) => {
    // A server started from the desktop app is connected to on 127.0.0.1, and
    // putting that in a link tells whoever receives it to connect to their own
    // machine (GRYT-135). Nothing errors — the address is valid, it is just the
    // wrong computer — so the sender has no reason to suspect the link.
    const shareable = pickShareableHost(host, advertised);

    if (shareable.kind === "loopback-only") {
      toast.error("This server has no address anyone else can reach.", { duration: 7000 });
      toast(
        "Add a public IP or hostname under Settings → My servers, then copy the invite again.",
        { duration: 10000, icon: "ℹ️" },
      );
      return;
    }

    try {
      const url = `https://gryt.chat/invite?host=${encodeURIComponent(shareable.host)}&code=${encodeURIComponent(code)}`;
      await navigator.clipboard.writeText(url);
      toast.success(
        shareable.host === host
          ? "Copied invite link"
          : `Copied invite link for ${shareable.host}`,
      );
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">
        This server is invite-only. Create invite codes to share with people you want to join.
      </span>

      <Surface>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-2" style={{ minWidth: 170, paddingTop: 22 }}>
              <Switch checked={infiniteUses} onCheckedChange={setInfiniteUses} />
              <span className="text-sm font-medium">
                Infinite uses
              </span>
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 140 }}>
              <span className="text-sm font-medium">
                Max uses
              </span>
              <TextField
                value={infiniteUses ? "∞" : maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="1"
                disabled={infiniteUses}
              />
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 180 }}>
              <span className="text-sm font-medium">
                Expires (hours)
              </span>
              <TextField
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                placeholder="e.g. 24"
              />
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 180 }}>
              <span className="text-sm font-medium">
                Custom code
              </span>
              <TextField
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder="Leave blank for random"
              />
            </div>
            <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 220 }}>
              <span className="text-sm font-medium">
                Note
              </span>
              <TextField value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          {grantableRoles.length > 0 && (
            <div className="flex flex-col gap-1" style={{ minWidth: 220 }}>
              <span className="text-sm font-medium">Gives the role</span>
              <select
                value={grantsRole}
                onChange={(e) => setGrantsRole(e.target.value)}
                className="bg-transparent border-b border-gryt-border outline-none text-sm py-1"
              >
                <option value="">No role, they join as normal</option>
                {grantableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-gryt-muted">
                Anybody joining on this link arrives holding that role, so the link is
                worth as much as the role is. Set the uses or an expiry unless you mean
                to hand it out forever. Only roles you have marked as invite-grantable
                appear here, and only ones below your own.
              </span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="small" onClick={refresh} disabled={creating || loading}>
              Refresh
            </Button>
            <Button size="small" onClick={create} disabled={creating}>
              <PiPlus size={16} />
              Create invite
            </Button>
          </div>
        </div>
      </Surface>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Active &amp; past invites
        </span>
        {invites.length === 0 ? (
          <span className="text-sm">
            No invites yet.
          </span>
        ) : (
          invites.map((i) => {
            const expiry = formatExpiry(toDate(i.expiresAt));
            const isInfinite = typeof i.maxUses === "number" && i.maxUses < 0;
            const uses = isInfinite
              ? `${typeof i.usesConsumed === "number" ? i.usesConsumed : 0} / ∞`
              : formatUses(i.usesRemaining, i.maxUses);
            return (
              <Surface key={i.code}>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-bold">
                        {i.code}
                      </span>
                      <span className="text-xs">
                        Uses: {uses} · Expires: {expiry}
                        {i.revoked ? " · Revoked" : ""}
                      </span>
                      {i.note ? (
                        <span className="text-xs">
                          {i.note}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <Button size="small" onClick={() => copy(i.code)}>
                        <PiCopyFill size={16} />
                        Copy
                      </Button>
                      <Button size="small"
                        disabled={!!i.revoked}
                        onClick={() => revoke(i.code)}
                      >
                        Revoke
                      </Button>
                    </div>
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

