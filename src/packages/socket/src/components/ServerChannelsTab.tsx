import { AlertDialog, Button, Select, Surface, Switch, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { PiPlus, PiTrashFill } from "react-icons/pi";
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
    <div className="flex flex-col gap-4">
      <Surface>
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium">
            {editingId ? "Edit channel" : "Create channel"}
          </span>
          <div className="flex gap-3 flex-wrap">
            <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 240 }}>
              <span className="text-sm font-medium">
                Name
              </span>
              <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Announcements" />
            </div>
            <div className="flex flex-col gap-1" style={{ minWidth: 160 }}>
              <span className="text-sm font-medium">
                Type
              </span>
              <select value={type} onChange={(e) => setType(e.target.value === "voice" ? "voice" : "text")}>
                <option value="text">text</option>
                <option value="voice">voice</option>
              </select>
            </div>
            <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 240 }}>
              <span className="text-sm font-medium">
                Description
              </span>
              <TextField value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          {type === "voice" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Switch checked={eSportsMode} onCheckedChange={(v) => {
                  setESportsMode(v);
                  if (v) { setRequirePushToTalk(true); setDisableRnnoise(true); }
                }} />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">eSports Mode</span>
                  <span className="text-xs">Lowest latency: PTT + no RNNoise + 128kbps studio cap + 10ms Opus frames</span>
                </div>
              </div>
              <div className="flex gap-4 flex-wrap items-center">
                <div className="flex items-center gap-2">
                  <Switch checked={requirePushToTalk} onCheckedChange={setRequirePushToTalk} disabled={eSportsMode} />
                  <span className="text-sm" color={eSportsMode ? "gray" : undefined}>Require Push to Talk</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={disableRnnoise} onCheckedChange={setDisableRnnoise} disabled={eSportsMode} />
                  <span className="text-sm" color={eSportsMode ? "gray" : undefined}>Disable RNNoise</span>
                </div>
                <div className="flex flex-col gap-1" style={{ minWidth: 220 }}>
                  <span className="text-sm font-medium">Max Bitrate</span>
                  <Select
                    value={maxBitrate}
                    onValueChange={(v) => setMaxBitrate(String(v))}
                    options={BITRATE_PRESETS.map((p) => ({
                      label: p.label,
                      value: p.value,
                    }))}
                  />
                </div>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button size="small" onClick={resetForm} disabled={submitting}>
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-medium">
            Existing channels
          </span>
          <Button size="small" onClick={refresh} disabled={submitting}>
            Refresh
          </Button>
        </div>

        {channels.length === 0 ? (
          <span className="text-sm">
            No channels found.
          </span>
        ) : (
          channels
            .slice()
            .sort((a, b) => ((a.position ?? 0) - (b.position ?? 0)) || a.name.localeCompare(b.name))
            .map((ch) => (
              <Surface key={ch.id}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">
                      {ch.name}
                    </span>
                    <span className="text-xs">
                      #{ch.id} · {ch.type}
                      {ch.description ? ` · ${ch.description}` : ""}
                      {ch.eSportsMode ? " · eSports" : ""}
                      {ch.requirePushToTalk ? " · PTT" : ""}
                      {ch.disableRnnoise ? " · No RNNoise" : ""}
                      {ch.maxBitrate ? ` · ${formatBitrate(ch.maxBitrate)}` : ""}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="small" onClick={() => startEdit(ch)} disabled={submitting}>
                      Edit
                    </Button>
                    <Button size="small" onClick={() => setPendingDeleteId(ch.id)} disabled={submitting}>
                      <PiTrashFill size={16} />
                      Delete
                    </Button>
                  </div>
                </div>
              </Surface>
            ))
        )}
      </div>

      <AlertDialog.Root open={!!pendingDeleteId} onOpenChange={(open) => { if (!open) setPendingDeleteId(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup className="max-w-105">
          <AlertDialog.Title>Delete channel?</AlertDialog.Title>
          <AlertDialog.Description>
            This will permanently delete &ldquo;{pendingDeleteChannel?.name || "this channel"}&rdquo; and all associated data. This action cannot be undone.
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close render={<span />}>
              <Button size="small">Cancel</Button>
            </AlertDialog.Close>
            <AlertDialog.Close render={<span />}>
              <Button size="small" onClick={() => { if (pendingDeleteId) { del(pendingDeleteId); setPendingDeleteId(null); } }}>
                Delete
              </Button>
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

