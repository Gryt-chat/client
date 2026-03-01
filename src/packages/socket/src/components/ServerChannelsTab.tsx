import { AlertDialog, Button, Card, Flex, Select, Switch, Text, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MdAdd, MdDelete } from "react-icons/md";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";

const BITRATE_PRESETS = [
  { value: "none",    label: "Default (no cap)" },
  { value: "8000",    label: "8 kbps — Narrowband" },
  { value: "16000",   label: "16 kbps — Wideband" },
  { value: "24000",   label: "24 kbps — VoIP" },
  { value: "32000",   label: "32 kbps — Voice (Low)" },
  { value: "48000",   label: "48 kbps — Voice (Medium)" },
  { value: "64000",   label: "64 kbps — Voice (Standard)" },
  { value: "96000",   label: "96 kbps — Voice (High)" },
  { value: "128000",  label: "128 kbps — Voice (Studio)" },
  { value: "160000",  label: "160 kbps — Music (Standard)" },
  { value: "192000",  label: "192 kbps — Music (High)" },
  { value: "256000",  label: "256 kbps — Music (Very High)" },
  { value: "320000",  label: "320 kbps — Music (Lossless-like)" },
  { value: "384000",  label: "384 kbps — Music (Premium)" },
  { value: "448000",  label: "448 kbps — Music (Ultra)" },
  { value: "510000",  label: "510 kbps — Opus Maximum" },
] as const;

function bitrateToPreset(bps: number | null | undefined): string {
  if (!bps) return "none";
  const match = BITRATE_PRESETS.find((p) => p.value === String(bps));
  return match ? match.value : String(bps);
}

function formatBitrate(bps: number | null | undefined): string {
  if (!bps) return "";
  const match = BITRATE_PRESETS.find((p) => p.value === String(bps));
  if (match) return match.label;
  return `${Math.round(bps / 1000)}kbps`;
}

export type ChannelItem = {
  id: string;
  name: string;
  type: "text" | "voice";
  description?: string | null;
  position?: number;
  requirePushToTalk?: boolean;
  disableRnnoise?: boolean;
  maxBitrate?: number | null;
  eSportsMode?: boolean;
};

export function ServerChannelsTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const [channels, setChannels] = useState<ChannelItem[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<"text" | "voice">("text");
  const [description, setDescription] = useState("");
  const [requirePushToTalk, setRequirePushToTalk] = useState(false);
  const [disableRnnoise, setDisableRnnoise] = useState(false);
  const [maxBitrate, setMaxBitrate] = useState("none");
  const [eSportsMode, setESportsMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeleteChannel = channels.find((ch) => ch.id === pendingDeleteId);

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:channels:list", { accessToken });
  };

  useSocketEvent<{ channels: ChannelItem[] }>(socket, "server:channels", (payload) => {
    setChannels(Array.isArray(payload?.channels) ? payload.channels : []);
  });

  useEffect(() => {
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  const startEdit = (ch: ChannelItem) => {
    setEditingId(ch.id);
    setName(ch.name || "");
    setType(ch.type || "text");
    setDescription((ch.description || "") as string);
    setRequirePushToTalk(ch.requirePushToTalk || false);
    setDisableRnnoise(ch.disableRnnoise || false);
    setMaxBitrate(bitrateToPreset(ch.maxBitrate));
    setESportsMode(ch.eSportsMode || false);
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setType("text");
    setDescription("");
    setRequirePushToTalk(false);
    setDisableRnnoise(false);
    setMaxBitrate("none");
    setESportsMode(false);
  };

  const upsert = async () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    if (!name.trim()) return toast.error("Channel name is required.");

    setSubmitting(true);
    try {
      const parsedBitrate = maxBitrate !== "none" ? parseInt(maxBitrate, 10) : NaN;
      socket.emit("server:channels:upsert", {
        accessToken,
        channelId: editingId || undefined,
        name: name.trim(),
        type,
        description: description.trim().length ? description.trim() : null,
        requirePushToTalk: requirePushToTalk,
        disableRnnoise: eSportsMode || disableRnnoise,
        maxBitrate: !isNaN(parsedBitrate) && parsedBitrate > 0 ? parsedBitrate : null,
        eSportsMode,
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
    <Flex direction="column" gap="4">
      <Card>
        <Flex direction="column" gap="3">
          <Text size="2" weight="medium">
            {editingId ? "Edit channel" : "Create channel"}
          </Text>
          <Flex gap="3" wrap="wrap">
            <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 240 }}>
              <Text size="2" weight="medium">
                Name
              </Text>
              <TextField.Root value={name} onChange={(e) => setName(e.target.value)} placeholder="Announcements" />
            </Flex>
            <Flex direction="column" gap="1" style={{ minWidth: 160 }}>
              <Text size="2" weight="medium">
                Type
              </Text>
              <select value={type} onChange={(e) => setType(e.target.value === "voice" ? "voice" : "text")}>
                <option value="text">text</option>
                <option value="voice">voice</option>
              </select>
            </Flex>
            <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 240 }}>
              <Text size="2" weight="medium">
                Description
              </Text>
              <TextField.Root value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </Flex>
          </Flex>
          {type === "voice" && (
            <Flex direction="column" gap="3">
              <Flex align="center" gap="2">
                <Switch checked={eSportsMode} onCheckedChange={(v) => {
                  setESportsMode(v);
                  if (v) { setRequirePushToTalk(true); setDisableRnnoise(true); }
                }} size="1" />
                <Flex direction="column">
                  <Text size="2" weight="medium">eSports Mode</Text>
                  <Text size="1" color="gray">Lowest latency: PTT + no RNNoise + 128kbps studio cap + 10ms Opus frames</Text>
                </Flex>
              </Flex>
              <Flex gap="4" wrap="wrap" align="center">
                <Flex align="center" gap="2">
                  <Switch checked={requirePushToTalk} onCheckedChange={setRequirePushToTalk} size="1" disabled={eSportsMode} />
                  <Text size="2" color={eSportsMode ? "gray" : undefined}>Require Push to Talk</Text>
                </Flex>
                <Flex align="center" gap="2">
                  <Switch checked={disableRnnoise} onCheckedChange={setDisableRnnoise} size="1" disabled={eSportsMode} />
                  <Text size="2" color={eSportsMode ? "gray" : undefined}>Disable RNNoise</Text>
                </Flex>
                <Flex direction="column" gap="1" style={{ minWidth: 220 }}>
                  <Text size="2" weight="medium">Max Bitrate</Text>
                  <Select.Root value={maxBitrate} onValueChange={setMaxBitrate}>
                    <Select.Trigger />
                    <Select.Content position="popper" sideOffset={4}>
                      {BITRATE_PRESETS.map((p) => (
                        <Select.Item key={p.value} value={p.value}>{p.label}</Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Flex>
              </Flex>
            </Flex>
          )}
          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={resetForm} disabled={submitting}>
              Reset
            </Button>
            <Button onClick={upsert} disabled={submitting}>
              <MdAdd size={16} />
              {editingId ? "Save" : "Add"}
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Flex direction="column" gap="2">
        <Flex align="center" justify="between" wrap="wrap" gap="2">
          <Text size="2" weight="medium">
            Existing channels
          </Text>
          <Button variant="soft" color="gray" onClick={refresh} disabled={submitting}>
            Refresh
          </Button>
        </Flex>

        {channels.length === 0 ? (
          <Text size="2" color="gray">
            No channels found.
          </Text>
        ) : (
          channels
            .slice()
            .sort((a, b) => ((a.position ?? 0) - (b.position ?? 0)) || a.name.localeCompare(b.name))
            .map((ch) => (
              <Card key={ch.id}>
                <Flex align="center" justify="between" gap="2" wrap="wrap">
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="bold">
                      {ch.name}
                    </Text>
                    <Text size="1" color="gray">
                      #{ch.id} · {ch.type}
                      {ch.description ? ` · ${ch.description}` : ""}
                      {ch.eSportsMode ? " · eSports" : ""}
                      {ch.requirePushToTalk ? " · PTT" : ""}
                      {ch.disableRnnoise ? " · No RNNoise" : ""}
                      {ch.maxBitrate ? ` · ${formatBitrate(ch.maxBitrate)}` : ""}
                    </Text>
                  </Flex>
                  <Flex gap="2">
                    <Button variant="soft" onClick={() => startEdit(ch)} disabled={submitting}>
                      Edit
                    </Button>
                    <Button variant="soft" color="red" onClick={() => setPendingDeleteId(ch.id)} disabled={submitting}>
                      <MdDelete size={16} />
                      Delete
                    </Button>
                  </Flex>
                </Flex>
              </Card>
            ))
        )}
      </Flex>

      <AlertDialog.Root open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Delete channel?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This will permanently delete &ldquo;{pendingDeleteChannel?.name || "this channel"}&rdquo; and all associated data. This action cannot be undone.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={() => { if (pendingDeleteId) { del(pendingDeleteId); setPendingDeleteId(null); } }}>
                Delete
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

