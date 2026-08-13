import { Avatar, Button, IconButton, Select, Surface, TextField, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiCopyFill, PiPlus, PiTrashFill } from "react-icons/pi";

import { getServerAccessToken, getServerHttpBase, getUploadsFileUrl } from "@/common";

type WebhookItem = {
  webhook_id: string;
  token: string;
  channel_id: string;
  display_name: string;
  avatar_file_id: string | null;
  url?: string;
};

type ChannelOption = {
  id: string;
  name: string;
  type: string;
};

export function ServerWebhooksTab({
  host,
  channels,
}: {
  host: string;
  channels: ChannelOption[];
}) {
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(false);

  const textChannels = channels.filter((c) => c.type === "text");

  const apiBase = host ? `${getServerHttpBase(host)}/api/webhooks` : "";

  const authHeaders = useCallback((): Record<string, string> => {
    const token = getServerAccessToken(host);
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [host]);

  const refresh = useCallback(async () => {
    if (!apiBase) return;
    setLoading(true);
    try {
      const res = await fetch(apiBase, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch webhooks");
      const data = await res.json() as { items: WebhookItem[] };
      setWebhooks(data.items ?? []);
    } catch {
      toast.error("Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  }, [apiBase, authHeaders]);

  useEffect(() => {
    if (host) refresh();
  }, [host, refresh]);

  const createWebhook = async () => {
    if (!apiBase) return;
    const channelId = textChannels[0]?.id ?? "";
    try {
      const res = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ channel_id: channelId, display_name: "New Webhook" }),
      });
      if (!res.ok) throw new Error("Failed to create webhook");
      const created = await res.json() as WebhookItem;
      setWebhooks((prev) => [created, ...prev]);
      toast.success("Webhook created");
    } catch {
      toast.error("Failed to create webhook");
    }
  };

  const deleteHook = async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete webhook");
      setWebhooks((prev) => prev.filter((w) => w.webhook_id !== id));
      toast.success("Webhook deleted");
    } catch {
      toast.error("Failed to delete webhook");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">
        Webhooks let external services post messages into your channels.
        Each webhook gets a unique URL that can be used to send messages.
      </span>

      <div className="flex justify-between items-center">
        <span className="text-base font-bold">Webhooks</span>
        <Button size="small" onClick={createWebhook} disabled={textChannels.length === 0}>
          <PiPlus size={16} />
          Create webhook
        </Button>
      </div>

      {textChannels.length === 0 && (
        <span className="text-sm">No text channels available. Create a text channel first.</span>
      )}

      {loading && webhooks.length === 0 && (
        <span className="text-sm">Loading...</span>
      )}

      {!loading && webhooks.length === 0 && (
        <span className="text-sm">No webhooks yet.</span>
      )}

      <div className="flex flex-col gap-3">
        {webhooks.map((w) => (
          <WebhookCard
            key={w.webhook_id}
            webhook={w}
            host={host}
            apiBase={apiBase}
            authHeaders={authHeaders}
            textChannels={textChannels}
            onDelete={deleteHook}
            onUpdate={(updated) =>
              setWebhooks((prev) => prev.map((x) => (x.webhook_id === updated.webhook_id ? updated : x)))
            }
          />
        ))}
      </div>
    </div>
  );
}

function WebhookCard({
  webhook,
  host,
  apiBase,
  authHeaders,
  textChannels,
  onDelete,
  onUpdate,
}: {
  webhook: WebhookItem;
  host: string;
  apiBase: string;
  authHeaders: () => Record<string, string>;
  textChannels: { id: string; name: string }[];
  onDelete: (id: string) => void;
  onUpdate: (w: WebhookItem) => void;
}) {
  const [name, setName] = useState(webhook.display_name);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const webhookUrl = webhook.url ?? `${getServerHttpBase(host)}/api/webhooks/${webhook.webhook_id}/${webhook.token}`;

  const save = useCallback(
    async (updates: Record<string, unknown>) => {
      try {
        const res = await fetch(`${apiBase}/${webhook.webhook_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error("Failed to update webhook");
        const updated = await res.json() as WebhookItem;
        onUpdate({ ...webhook, ...updated });
      } catch {
        toast.error("Failed to save webhook");
      }
    },
    [apiBase, webhook, authHeaders, onUpdate],
  );

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== webhook.display_name) {
          save({ display_name: trimmed });
        }
      }, 600);
    },
    [webhook.display_name, save],
  );

  const handleNameBlur = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const trimmed = name.trim();
    if (trimmed && trimmed !== webhook.display_name) {
      save({ display_name: trimmed });
    }
  }, [name, webhook.display_name, save]);

  const handleChannelChange = useCallback(
    (channelId: string) => {
      save({ channel_id: channelId });
    },
    [save],
  );

  const handleAvatarClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAvatarUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch(`${getServerHttpBase(host)}/api/uploads`, {
          method: "POST",
          headers: authHeaders(),
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("Upload failed");
        const uploadData = await uploadRes.json() as { file_id: string };
        await save({ avatar_file_id: uploadData.file_id });
        toast.success("Avatar updated");
      } catch {
        toast.error("Failed to upload avatar");
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [host, authHeaders, save],
  );

  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("Webhook URL copied");
    } catch {
      toast.error("Failed to copy");
    }
  }, [webhookUrl]);

  const avatarUrl = webhook.avatar_file_id && host
    ? getUploadsFileUrl(host, webhook.avatar_file_id, { thumb: true })
    : undefined;

  return (
    <Surface>
      <div className="flex gap-3 items-start">
        <Tooltip title="Click to change avatar">
          <button
            onClick={handleAvatarClick}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              borderRadius: "var(--radius-full)",
              flexShrink: 0,
            }}
          >
            <Avatar size="large" fallback={name[0] || "W"} src={avatarUrl} />
          </button>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={handleAvatarUpload}
        />

        <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 0 }}>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 160 }}>
              <span className="text-xs font-medium">Name</span>
              <TextField
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                onBlur={handleNameBlur}
                placeholder="Webhook name"
              />
            </div>

            <div className="flex flex-col gap-1" style={{ minWidth: 160 }}>
              <span className="text-xs font-medium">Channel</span>
              <Select
                value={webhook.channel_id}
                onValueChange={(v) => handleChannelChange(String(v))}
                placeholder="Select channel"
                options={textChannels.map((ch) => ({
                  label: `# ${ch.name}`,
                  value: ch.id,
                }))}
              />
            </div>

            <div className="flex gap-1" style={{ paddingBottom: 1 }}>
              <Tooltip title="Copy webhook URL">
                <IconButton size="xsmall" onClick={copyUrl}>
                  <PiCopyFill size={16} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete webhook">
                <IconButton size="xsmall" onClick={() => onDelete(webhook.webhook_id)}>
                  <PiTrashFill size={16} />
                </IconButton>
              </Tooltip>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs" style={{
              fontFamily: "var(--code-font-family)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              opacity: 0.6,
            }}>
              {webhookUrl}
            </span>
          </div>
        </div>
      </div>
    </Surface>
  );
}
