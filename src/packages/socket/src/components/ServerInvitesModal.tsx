import { Copy as CopyIcon, X as Cross2Icon, Plus as PlusIcon } from "lucide-react";
import { Button, Card,Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

import { useSockets } from "../hooks/useSockets";

type InvitesOpenDetail = { host: string };

type InviteItem = {
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

function fmt(d: Date | null): string {
  if (!d) return "Never";
  return d.toLocaleString();
}

export function ServerInvitesModal() {
  const { sockets } = useSockets();

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState<string>("");
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [maxUses, setMaxUses] = useState<string>("1");
  const [expiresInHours, setExpiresInHours] = useState<string>("");
  const [note, setNote] = useState<string>("");

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);
  const accessToken = useMemo(() => (host ? getServerAccessToken(host) : null), [host]);

  useEffect(() => {
    const handler = (event: CustomEvent<InvitesOpenDetail>) => {
      setHost(event.detail.host);
      setIsOpen(true);
    };
    window.addEventListener("server_invites_open", handler as EventListener);
    return () => window.removeEventListener("server_invites_open", handler as EventListener);
  }, []);

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
    if (!isOpen) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, host, socket?.connected]);

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
      setInvites((prev) => prev.map((i) => (i.code === payload.code ? { ...i, revoked: payload.revoked } : i)));
    };

    socket.on("server:invites", onInvites);
    socket.on("server:invite:created", onInviteCreated);
    socket.on("server:invite:revoked", onInviteRevoked);
    return () => {
      socket.off("server:invites", onInvites);
      socket.off("server:invite:created", onInviteCreated);
      socket.off("server:invite:revoked", onInviteRevoked);
    };
  }, [socket]);

  const close = () => {
    if (creating) return;
    setIsOpen(false);
    setHost("");
    setInvites([]);
  };

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
      const origin = typeof window !== "undefined" ? window.location.origin : "https://app.gryt.chat";
      const url = `${origin}/invite?host=${encodeURIComponent(host)}&code=${encodeURIComponent(code)}`;
      await navigator.clipboard.writeText(url);
      toast.success("Copied invite link");
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : close())}>
      <Dialog.Content style={{ maxWidth: 680 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Dialog.Title>Invites</Dialog.Title>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={close} disabled={creating}>
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>

          <Text size="2" color="gray">
            Create invite codes you can share instead of the server password.
          </Text>

          <Card>
            <Flex direction="column" gap="3">
              <Flex gap="3" wrap="wrap">
                <Flex direction="column" gap="1" style={{ minWidth: 140 }}>
                  <Text size="2" weight="medium">Max uses</Text>
                  <TextField.Root value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="1" />
                </Flex>
                <Flex direction="column" gap="1" style={{ minWidth: 180 }}>
                  <Text size="2" weight="medium">Expires (hours)</Text>
                  <TextField.Root value={expiresInHours} onChange={(e) => setExpiresInHours(e.target.value)} placeholder="e.g. 24" />
                </Flex>
                <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 220 }}>
                  <Text size="2" weight="medium">Note</Text>
                  <TextField.Root value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
                </Flex>
              </Flex>
              <Flex justify="end" gap="2">
                <Button variant="soft" color="gray" onClick={refresh} disabled={creating || loading}>
                  Refresh
                </Button>
                <Button onClick={create} disabled={creating}>
                  <PlusIcon />
                  Create invite
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              Active & past invites
            </Text>
            {invites.length === 0 ? (
              <Text size="2" color="gray">
                No invites yet.
              </Text>
            ) : (
              invites.map((i) => {
                const createdAt = fmt(toDate(i.createdAt));
                const expiresAt = fmt(toDate(i.expiresAt));
                const remaining = typeof i.usesRemaining === "number" ? i.usesRemaining : undefined;
                return (
                  <Card key={i.code}>
                    <Flex direction="column" gap="2">
                      <Flex align="center" justify="between" gap="2" wrap="wrap">
                        <Flex direction="column" gap="1">
                          <Text size="2" weight="bold">{i.code}</Text>
                          <Text size="1" color="gray">
                            Remaining: {remaining ?? "?"} · Expires: {expiresAt} · Created: {createdAt}
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
                            <CopyIcon />
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
      </Dialog.Content>
    </Dialog.Root>
  );
}

