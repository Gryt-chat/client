import { AlertDialog, Button, Dialog, IconButton, Surface, TextField } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PiPlus, PiTrashFill, PiX } from "react-icons/pi";

import { getServerAccessToken } from "@/common";

import { useSocketEvent } from "../hooks/useSocketEvent";
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

  useSocketEvent<{ channels: ChannelItem[] }>(socket, "server:channels", (payload) => {
    setChannels(Array.isArray(payload?.channels) ? payload.channels : []);
  });

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
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 760 }}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Dialog.Title>Channels</Dialog.Title>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall" onClick={close} disabled={submitting}>
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

          <Surface>
            <div className="flex flex-col gap-3">
              <span className="text-sm font-medium">
                {editingId ? "Edit channel" : "Create channel"}
              </span>
              <div className="flex gap-3 flex-wrap">
                <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 240 }}>
                  <span className="text-sm font-medium">Name</span>
                  <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Announcements" />
                </div>
                <div className="flex flex-col gap-1" style={{ minWidth: 160 }}>
                  <span className="text-sm font-medium">Type</span>
                  <select value={type} onChange={(e) => setType(e.target.value === "voice" ? "voice" : "text")}>
                    <option value="text">text</option>
                    <option value="voice">voice</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 240 }}>
                  <span className="text-sm font-medium">Description</span>
                  <TextField value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button tone="neutral" size="small" onClick={resetForm} disabled={submitting}>
                  Reset
                </Button>
                <Button size="small" onClick={upsert} disabled={submitting}>
                  <PiPlus size={16} />
                  {editingId ? "Save" : "Add"}
                </Button>
              </div>
            </div>
          </Surface>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Existing channels</span>
            {channels.length === 0 ? (
              <span className="text-sm text-gryt-muted">No channels found.</span>
            ) : (
              channels
                .slice()
                .sort((a, b) => ((a.position ?? 0) - (b.position ?? 0)) || a.name.localeCompare(b.name))
                .map((ch) => (
                  <Surface key={ch.id}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-bold">{ch.name}</span>
                        <span className="text-xs text-gryt-muted">
                          #{ch.id} · {ch.type}
                          {ch.description ? ` · ${ch.description}` : ""}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button tone="neutral" size="small" onClick={() => startEdit(ch)} disabled={submitting}>
                          Edit
                        </Button>
                        <Button tone="danger" size="small" onClick={() => setPendingDeleteId(ch.id)} disabled={submitting}>
                          <PiTrashFill size={16} />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Surface>
                ))
            )}
          </div>
        </div>

        <AlertDialog.Root open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Popup>
            <AlertDialog.Title>Delete channel?</AlertDialog.Title>
            <AlertDialog.Description>
              This will permanently delete &ldquo;{channels.find((c) => c.id === pendingDeleteId)?.name || "this channel"}&rdquo; and all associated data. This action cannot be undone.
            </AlertDialog.Description>
            <div className="flex gap-3 mt-4 justify-end">
              <AlertDialog.Close render={<span />}>
                <Button tone="neutral" size="small">Cancel</Button>
              </AlertDialog.Close>
              <AlertDialog.Close render={<span />}>
                <Button tone="danger" size="small" onClick={() => { if (pendingDeleteId) { del(pendingDeleteId); setPendingDeleteId(null); } }}>Delete</Button>
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

