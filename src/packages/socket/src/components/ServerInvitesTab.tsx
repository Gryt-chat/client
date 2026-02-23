import { Button, Card, Flex, Text, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MdAdd, MdContentCopy } from "react-icons/md";

export type InviteItem = {
  code: string;
  createdAt?: string | Date;
  expiresAt?: string | Date | null;
  maxUses?: number;
  usesRemaining?: number;
  revoked?: boolean;
  note?: string | null;
};

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
  if (remaining === undefined) return "?";
  if (max !== undefined) return `${remaining} / ${max}`;
  return String(remaining);
}

export function ServerInvitesTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: { connected: boolean; emit: (event: string, data: unknown) => void; on: (event: string, handler: (...args: unknown[]) => void) => void; off: (event: string, handler: (...args: unknown[]) => void) => void };
  accessToken: string | null;
}) {
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [maxUses, setMaxUses] = useState<string>("1");
  const [expiresInHours, setExpiresInHours] = useState<string>("");
  const [note, setNote] = useState<string>("");
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

  useEffect(() => {
    if (!socket) return;

    const onInvites = (payload: { invites: InviteItem[] }) => {
      setInvites(Array.isArray(payload?.invites) ? payload.invites : []);
    };
    const onInviteCreated = (payload: { invite?: InviteItem }) => {
      const inv = payload?.invite;
      if (!inv?.code) return;
      setInvites((prev) => [inv, ...prev.filter((p) => p.code !== inv.code)]);
      toast.success("Invite created");
    };
    const onInviteRevoked = (payload: { code: string; revoked: boolean }) => {
      setInvites((prev) =>
        prev.map((i) => (i.code === payload.code ? { ...i, revoked: payload.revoked } : i))
      );
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:invites", onInvites as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:invite:created", onInviteCreated as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:invite:revoked", onInviteRevoked as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:invites", onInvites as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:invite:created", onInviteCreated as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:invite:revoked", onInviteRevoked as any);
    };
  }, [socket]);

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

    setCreating(true);
    try {
      socket.emit("server:invites:create", {
        accessToken,
        maxUses: mu,
        expiresInHours: typeof eh === "number" && eh > 0 ? eh : undefined,
        note: note.trim().length ? note.trim() : null,
      });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string, revoked: boolean) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:invites:revoke", { accessToken, code, revoked });
  };

  const copy = async (code: string) => {
    try {
      const url = `https://gryt.chat/invite?host=${encodeURIComponent(host)}&code=${encodeURIComponent(code)}`;
      await navigator.clipboard.writeText(url);
      toast.success("Copied invite link");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <Flex direction="column" gap="4">
      <Text size="2" color="gray">
        Create invite codes you can share instead of the server password.
      </Text>

      <Card>
        <Flex direction="column" gap="3">
          <Flex gap="3" wrap="wrap">
            <Flex direction="column" gap="1" style={{ minWidth: 140 }}>
              <Text size="2" weight="medium">
                Max uses
              </Text>
              <TextField.Root value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="1" />
            </Flex>
            <Flex direction="column" gap="1" style={{ minWidth: 180 }}>
              <Text size="2" weight="medium">
                Expires (hours)
              </Text>
              <TextField.Root
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value)}
                placeholder="e.g. 24"
              />
            </Flex>
            <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 220 }}>
              <Text size="2" weight="medium">
                Note
              </Text>
              <TextField.Root value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Flex>
          </Flex>
          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={refresh} disabled={creating || loading}>
              Refresh
            </Button>
            <Button onClick={create} disabled={creating}>
              <MdAdd size={16} />
              Create invite
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Active &amp; past invites
        </Text>
        {invites.length === 0 ? (
          <Text size="2" color="gray">
            No invites yet.
          </Text>
        ) : (
          invites.map((i) => {
            const expiry = formatExpiry(toDate(i.expiresAt));
            const uses = formatUses(i.usesRemaining, i.maxUses);
            return (
              <Card key={i.code}>
                <Flex direction="column" gap="2">
                  <Flex align="center" justify="between" gap="2" wrap="wrap">
                    <Flex direction="column" gap="1">
                      <Text size="2" weight="bold">
                        {i.code}
                      </Text>
                      <Text size="1" color="gray">
                        Uses: {uses} · Expires: {expiry}
                        {i.revoked ? " · Revoked" : ""}
                      </Text>
                      {i.note ? (
                        <Text size="1" color="gray">
                          {i.note}
                        </Text>
                      ) : null}
                    </Flex>
                    <Flex gap="2">
                      <Button variant="soft" onClick={() => copy(i.code)}>
                        <MdContentCopy size={16} />
                        Copy
                      </Button>
                      <Button
                        color={i.revoked ? "green" : "red"}
                        variant="soft"
                        onClick={() => revoke(i.code, !i.revoked)}
                      >
                        {i.revoked ? "Unrevoke" : "Revoke"}
                      </Button>
                    </Flex>
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

