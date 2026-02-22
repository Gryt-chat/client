import { Cross2Icon, PlusIcon, TrashIcon } from "@radix-ui/react-icons";
import { AlertDialog, Button, Card,Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

import { useSockets } from "../hooks/useSockets";

type OpenDetail = { host: string };

type ChannelItem = {
  id: string;
  name: string;
  type: "text" | "voice";
  description?: string | null;
  position?: number;
};

export function ServerChannelsModal() {
  const { sockets } = useSockets();

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState("");
  const [channels, setChannels] = useState<ChannelItem[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">("text");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);
  const accessToken = useMemo(() => (host ? getServerAccessToken(host) : null), [host]);

  useEffect(() => {
    const handler = (event: CustomEvent<OpenDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setIsOpen(true);
    };
    window.addEventListener("server_channels_open", handler as EventListener);
    return () => window.removeEventListener("server_channels_open", handler as EventListener);
  }, []);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:channels:list", { accessToken });
  };

  useEffect(() => {
    if (!socket) return;
    const onChannels = (payload: { channels: ChannelItem[] }) => {
      setChannels(Array.isArray(payload?.channels) ? payload.channels : []);
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:channels", onChannels as any);
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:channels", onChannels as any);
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
    setChannels([]);
    setEditingId(null);
    setName("");
    setType("text");
    setDescription("");
  };

  const startEdit = (ch: ChannelItem) => {
    setEditingId(ch.id);
    setName(ch.name || "");
    setType(ch.type || "text");
    setDescription((ch.description || "") as string);
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setType("text");
    setDescription("");
  };

  const upsert = async () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    if (!name.trim()) return toast.error("Channel name is required.");

    setSubmitting(true);
    try {
      socket.emit("server:channels:upsert", {
        accessToken,
        channelId: editingId || undefined,
        name: name.trim(),
        type,
        description: description.trim().length ? description.trim() : null,
      });
      toast.success(editingId ? "Channel updated" : "Channel created");
      resetForm();
      setTimeout(refresh, 200);
    } finally {
      setSubmitting(false);
    }
  };

  const del = async (channelId: string) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    setSubmitting(true);
    try {
      socket.emit("server:channels:delete", { accessToken, channelId });
      toast.success("Channel deleted");
      setTimeout(refresh, 200);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : close())}>
      <Dialog.Content style={{ maxWidth: 760 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Dialog.Title>Channels</Dialog.Title>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={close} disabled={submitting}>
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>

          <Card>
            <Flex direction="column" gap="3">
              <Text size="2" weight="medium">
                {editingId ? "Edit channel" : "Create channel"}
              </Text>
              <Flex gap="3" wrap="wrap">
                <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 240 }}>
                  <Text size="2" weight="medium">Name</Text>
                  <TextField.Root value={name} onChange={(e) => setName(e.target.value)} placeholder="Announcements" />
                </Flex>
                <Flex direction="column" gap="1" style={{ minWidth: 160 }}>
                  <Text size="2" weight="medium">Type</Text>
                  <select value={type} onChange={(e) => setType(e.target.value === "voice" ? "voice" : "text")}>
                    <option value="text">text</option>
                    <option value="voice">voice</option>
                  </select>
                </Flex>
                <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 240 }}>
                  <Text size="2" weight="medium">Description</Text>
                  <TextField.Root value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
                </Flex>
              </Flex>
              <Flex justify="end" gap="2">
                <Button variant="soft" color="gray" onClick={resetForm} disabled={submitting}>
                  Reset
                </Button>
                <Button onClick={upsert} disabled={submitting}>
                  <PlusIcon />
                  {editingId ? "Save" : "Add"}
                </Button>
              </Flex>
            </Flex>
          </Card>

          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">Existing channels</Text>
            {channels.length === 0 ? (
              <Text size="2" color="gray">No channels found.</Text>
            ) : (
              channels
                .slice()
                .sort((a, b) => ((a.position ?? 0) - (b.position ?? 0)) || a.name.localeCompare(b.name))
                .map((ch) => (
                  <Card key={ch.id}>
                    <Flex align="center" justify="between" gap="2" wrap="wrap">
                      <Flex direction="column" gap="1">
                        <Text size="2" weight="bold">{ch.name}</Text>
                        <Text size="1" color="gray">
                          #{ch.id} · {ch.type}
                          {ch.description ? ` · ${ch.description}` : ""}
                        </Text>
                      </Flex>
                      <Flex gap="2">
                        <Button variant="soft" onClick={() => startEdit(ch)} disabled={submitting}>
                          Edit
                        </Button>
                        <Button variant="soft" color="red" onClick={() => setPendingDeleteId(ch.id)} disabled={submitting}>
                          <TrashIcon />
                          Delete
                        </Button>
                      </Flex>
                    </Flex>
                  </Card>
                ))
            )}
          </Flex>
        </Flex>

        <AlertDialog.Root open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
          <AlertDialog.Content maxWidth="420px">
            <AlertDialog.Title>Delete channel?</AlertDialog.Title>
            <AlertDialog.Description size="2">
              This will permanently delete &ldquo;{channels.find((c) => c.id === pendingDeleteId)?.name || "this channel"}&rdquo; and all associated data. This action cannot be undone.
            </AlertDialog.Description>
            <Flex gap="3" mt="4" justify="end">
              <AlertDialog.Cancel>
                <Button variant="soft" color="gray">Cancel</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action>
                <Button variant="solid" color="red" onClick={() => { if (pendingDeleteId) { del(pendingDeleteId); setPendingDeleteId(null); } }}>Delete</Button>
              </AlertDialog.Action>
            </Flex>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </Dialog.Content>
    </Dialog.Root>
  );
}

