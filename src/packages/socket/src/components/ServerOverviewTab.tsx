import { AlertDialog, Avatar, Button, Select, Switch, TextField } from "@gryt/ui";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiCameraFill, PiTrashFill } from "react-icons/pi";

import { GeneratedServerIcon, getServerAccessToken, getServerHttpBase } from "@/common";
import { useSettings } from "@/settings";
import type { Channel } from "@/settings/src/types/server";

import { useServerPermissions } from "../hooks/usePermissions";

type ProfanityMode = "off" | "flag" | "censor" | "block";

/** Mirrors the server's `JoinPolicy`. `approval` exists there as room to grow. */
type JoinPolicy = "invite" | "request" | "open";

/**
 * Anything unrecognised reads as `invite`, matching the server's own
 * normaliseJoinPolicy. A value from a newer server must leave a server harder to
 * get into, never easier — so this fails shut on both sides of the wire.
 */
function normalizeJoinPolicy(v: unknown): JoinPolicy {
  return v === "open" ? "open" : v === "request" ? "request" : "invite";
}
type CensorStyle = "grawlix" | "emoji" | "asterisks" | "block" | "hearts";

type ServerSettingsPayload = {
  serverId: string;
  isOwner: boolean;
  isConfigured: boolean;
  displayName: string;
  description: string;
  iconUrl: string | null;
  avatarMaxBytes?: number | null;
  uploadMaxBytes?: number | null;
  emojiMaxBytes?: number | null;
  profanityMode?: ProfanityMode;
  profanityCensorStyle?: CensorStyle;
  systemChannelId?: string | null;
  lanOpen?: boolean;
  joinPolicy?: JoinPolicy;
  discoverable?: boolean;
};

export type ServerOverviewInitialSettings = {
  displayName?: string;
  description?: string;
};

export function ServerOverviewTab({
  host,
  socket,
  accessToken,
  initialSettings,
  channels = [],
}: {
  host: string;
  socket?: {
    connected: boolean;
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
  };
  accessToken: string | null;
  initialSettings?: ServerOverviewInitialSettings;
  channels?: Channel[];
}) {
  const { nickname } = useSettings();

  const MAX_ICON_SIZE_BYTES = 25 * 1024 * 1024;

  /**
   * Whether this member may change any of this.
   *
   * Was `canEdit`, off the settings payload. `manage_server` is owner-only by
   * default, so for a server nobody has touched the answer is the same — but an
   * owner who grants it to a role should get a form that works, rather than one
   * that looks read-only and would have been accepted.
   */
  const { can } = useServerPermissions(host);
  const canEdit = can("manage_server");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isClearingIcon, setIsClearingIcon] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconCacheBuster, setIconCacheBuster] = useState(0);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [showClearIconConfirm, setShowClearIconConfirm] = useState(false);

  const iconBusy = isUploadingIcon || isClearingIcon;

  const [profanityMode, setProfanityMode] = useState<ProfanityMode>("censor");
  const [censorStyle, setCensorStyle] = useState<CensorStyle>("emoji");
  const [systemChannelId, setSystemChannelId] = useState<string | null>(null);
  const [lanOpen, setLanOpen] = useState(false);
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("invite");
  const [discoverable, setDiscoverable] = useState(true);

  const [autosaving, setAutosaving] = useState(false);
  const pendingSaveCountRef = useRef(0);
  const lastSettingsRef = useRef<{
    displayName: string;
    description: string;
    avatarMaxBytes: number | null;
    uploadMaxBytes: number | null;
    emojiMaxBytes: number | null;
    profanityMode: ProfanityMode;
    profanityCensorStyle: CensorStyle;
    systemChannelId: string | null;
    lanOpen: boolean;
    joinPolicy: JoinPolicy;
    discoverable: boolean;
  } | null>(null);

  const [avatarMaxMb, setAvatarMaxMb] = useState<string>("");
  const [uploadMaxMb, setUploadMaxMb] = useState<string>("");
  const [emojiMaxMb, setEmojiMaxMb] = useState<string>("");

  const effectiveAccessToken = useMemo(() => accessToken || getServerAccessToken(host), [accessToken, host]);

  const textChannels = useMemo(
    () => channels.filter((c) => c.type === "text"),
    [channels],
  );

  // Apply any initial settings when host changes (best-effort prefill).
  useEffect(() => {
    if (!initialSettings) return;
    if (typeof initialSettings.displayName === "string") setDisplayName(initialSettings.displayName);
    if (typeof initialSettings.description === "string") setDescription(initialSettings.description);
  }, [host, initialSettings]);

  const isServerSettingsPayload = (x: unknown): x is ServerSettingsPayload => {
    if (!x || typeof x !== "object") return false;
    const p = x as Partial<ServerSettingsPayload>;
    return typeof p.serverId === "string" &&
      typeof p.isOwner === "boolean" &&
      typeof p.isConfigured === "boolean" &&
      typeof p.displayName === "string" &&
      typeof p.description === "string" &&
      typeof p.iconUrl !== "undefined";
  };

  // Fetch current settings when opened/host changes.
  useEffect(() => {
    if (!host) return;
    if (!socket) return;
    if (!socket.connected) return;

    const onSettings = (payload: unknown) => {
      if (!isServerSettingsPayload(payload)) return;
      const wasSaving = pendingSaveCountRef.current > 0;

      setIconUrl(payload.iconUrl || null);

      const toMbString = (bytes?: number | null) => {
        if (!bytes || !Number.isFinite(bytes)) return "";
        const mb = bytes / (1024 * 1024);
        return (Math.round(mb * 10) / 10).toString();
      };

      setProfanityMode(payload.profanityMode ?? "censor");
      setCensorStyle(payload.profanityCensorStyle ?? "emoji");
      setSystemChannelId(payload.systemChannelId ?? null);
      setLanOpen(!!payload.lanOpen);
      setJoinPolicy(normalizeJoinPolicy(payload.joinPolicy));
      setDiscoverable(payload.discoverable !== false);

      if (!wasSaving) {
        setDisplayName(payload.displayName || "");
        setDescription(payload.description || "");
        setAvatarMaxMb(toMbString(payload.avatarMaxBytes));
        setUploadMaxMb(toMbString(payload.uploadMaxBytes));
        setEmojiMaxMb(toMbString(payload.emojiMaxBytes));
      } else {
        toast.success("Settings saved");
      }

      pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
      if (pendingSaveCountRef.current === 0) setAutosaving(false);

      lastSettingsRef.current = {
        displayName: payload.displayName || "",
        description: payload.description || "",
        avatarMaxBytes: (typeof payload.avatarMaxBytes === "number" && Number.isFinite(payload.avatarMaxBytes)) ? payload.avatarMaxBytes : null,
        uploadMaxBytes: (typeof payload.uploadMaxBytes === "number" && Number.isFinite(payload.uploadMaxBytes)) ? payload.uploadMaxBytes : null,
        emojiMaxBytes: (typeof payload.emojiMaxBytes === "number" && Number.isFinite(payload.emojiMaxBytes)) ? payload.emojiMaxBytes : null,
        profanityMode: payload.profanityMode ?? "censor",
        profanityCensorStyle: payload.profanityCensorStyle ?? "emoji",
        systemChannelId: payload.systemChannelId ?? null,
        lanOpen: !!payload.lanOpen,
        joinPolicy: normalizeJoinPolicy(payload.joinPolicy),
        discoverable: payload.discoverable !== false,
      };
    };

    const onError = (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const err = payload as { error?: string; message?: string };
      if (err.error === "settings_update_failed" || err.error === "forbidden" || err.error === "token_invalid") {
        if (pendingSaveCountRef.current > 0) {
          pendingSaveCountRef.current = 0;
          setAutosaving(false);
          toast.error(err.message || "Failed to save settings.");
          socket.emit("server:settings:get");
        }
      }
    };

    socket.on("server:settings", onSettings);
    socket.on("server:error", onError);
    socket.emit("server:settings:get");

    const retryTimer = setTimeout(() => {
      if (!lastSettingsRef.current) {
        socket.emit("server:settings:get");
      }
    }, 3000);

    return () => {
      socket.off("server:settings", onSettings);
      socket.off("server:error", onError);
      clearTimeout(retryTimer);
    };
  }, [host, socket]);


  const ensureJoined = () => {
    if (!socket?.connected) return;
    if (!nickname) return;
    socket.emit("server:join", { nickname });
  };

  const parseMbToBytes = (s: string): number | null => {
    const raw = (s || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n * 1024 * 1024);
  };
  const emitSettingsUpdate = (patch: Partial<{
    displayName: string;
    description: string;
    avatarMaxBytes: number | null;
    uploadMaxBytes: number | null;
    emojiMaxBytes: number | null;
    profanityMode: ProfanityMode;
    profanityCensorStyle: CensorStyle;
    systemChannelId: string | null;
    lanOpen: boolean;
    joinPolicy: JoinPolicy;
    discoverable: boolean;
  }>): boolean => {
    if (!host || !socket || !socket.connected) {
      toast.error("Not connected to the server.");
      return false;
    }
    if (!effectiveAccessToken) {
      ensureJoined();
      toast.error("Missing access token. Try rejoining the server.");
      return false;
    }
    if (!canEdit) {
      toast.error("Only the server owner can change settings.");
      return false;
    }

    if (lastSettingsRef.current) {
      lastSettingsRef.current = { ...lastSettingsRef.current, ...patch };
    }

    pendingSaveCountRef.current += 1;
    setAutosaving(true);
    socket.emit("server:settings:update", {
      accessToken: effectiveAccessToken,
      ...patch,
    });
    return true;
  };

  const saveIfChanged = (patch: Parameters<typeof emitSettingsUpdate>[0]): boolean => {
    const last = lastSettingsRef.current;
    if (last) {
      const entries = Object.entries(patch) as Array<[keyof typeof patch, string | number | null | boolean | undefined]>;
      const changed = entries.some(([k, v]) => last[k] !== v);
      if (!changed) return true;
    }
    return emitSettingsUpdate(patch);
  };

  const uploadIcon = async (file: File) => {
    if (!host) return;
    if (!socket || !socket.connected) {
      toast.error("Not connected to the server.");
      return;
    }
    if (!effectiveAccessToken) {
      await ensureJoined();
      return;
    }
    if (!canEdit) {
      toast.error("Only the server owner can change the icon.");
      return;
    }
    if (file.size > MAX_ICON_SIZE_BYTES) {
      toast.error("Icon too large (max 25MB).");
      return;
    }
    if (!/^image\/(png|jpeg|webp|gif|avif)$/i.test(file.type || "")) {
      toast.error("Unsupported icon format. Use PNG, JPEG, WebP, GIF, or AVIF.");
      return;
    }
    setIsUploadingIcon(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const resp = await fetch(`${getServerHttpBase(host)}/api/server/icon`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveAccessToken}`,
        },
        body: form,
      });
      const raw = await resp.text().catch(() => "");
      let data: Record<string, unknown> = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!resp.ok) {
        const msg =
          (typeof data?.message === "string" && data.message.trim().length > 0)
            ? data.message
            : (typeof data?.error === "string" && data.error.trim().length > 0)
              ? data.error
              : (raw && raw.trim().length > 0)
                ? raw.trim()
                : `HTTP ${resp.status} ${resp.statusText || ""}`.trim();
        throw new Error(msg);
      }
      toast.success("Icon updated");
      setIconCacheBuster((v) => v + 1);
      socket?.emit("server:settings:get");
      socket?.emit("server:details");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Icon upload failed");
    } finally {
      setIsUploadingIcon(false);
    }
  };

  const clearIcon = async () => {
    if (!host) return;
    if (!socket || !socket.connected) {
      toast.error("Not connected to the server.");
      return;
    }
    if (!effectiveAccessToken) {
      await ensureJoined();
      return;
    }
    if (!canEdit) {
      toast.error("Only the server owner can change the icon.");
      return;
    }

    setIsClearingIcon(true);
    try {
      const resp = await fetch(`${getServerHttpBase(host)}/api/server/icon`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${effectiveAccessToken}`,
        },
      });
      const raw = await resp.text().catch(() => "");
      let data: Record<string, unknown> = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!resp.ok) {
        const msg =
          (typeof data?.message === "string" && data.message.trim().length > 0)
            ? data.message
            : (typeof data?.error === "string" && data.error.trim().length > 0)
              ? data.error
              : (raw && raw.trim().length > 0)
                ? raw.trim()
                : `HTTP ${resp.status} ${resp.statusText || ""}`.trim();
        throw new Error(msg);
      }

      setIconUrl(null);
      setIconCacheBuster((v) => v + 1);
      toast.success("Icon cleared");
      socket?.emit("server:settings:get");
      socket?.emit("server:details");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to clear icon");
    } finally {
      setIsClearingIcon(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">
        {canEdit
          ? "Update the server display name and icon."
          : "You can see these settings, but your role cannot change them."}
      </span>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Server
        </span>
        <span className="text-sm">
          {host}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Display name
        </span>
        <TextField
          value={displayName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDisplayName(e.target.value)}
          onBlur={() => saveIfChanged({ displayName: displayName.trim() })}
          placeholder="My Gryt Server"
          disabled={!canEdit}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Description
        </span>
        <TextField
          multiline
          minRows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => saveIfChanged({ description: description.trim() })}
          placeholder="A place to hang out"
          disabled={!canEdit}
          style={{ minHeight: 90 }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Server icon
        </span>
        {/** Only the avatar is clickable (not whitespace). */}
        <div className="flex flex-col items-center gap-2" style={{
            cursor: "default",
            opacity: iconBusy ? 0.6 : 1,
            transition: "opacity 200ms",
            paddingTop: 8,
            paddingBottom: 4,
          }}>
          <button
            type="button"
            disabled={!canEdit || iconBusy}
            onClick={() => iconInputRef.current?.click()}
            aria-label="Change server icon"
            style={{
              all: "unset",
              cursor: canEdit && !iconBusy ? "pointer" : "default",
              borderRadius: 9999,
            }}
          >
            <div style={{ position: "relative" }}>
              <Avatar
                size="large"
                className="h-24 w-24 text-3xl"
                src={iconUrl ? `${getServerHttpBase(host)}/icon?v=${iconCacheBuster}` : undefined}
                fallback={displayName || host ? <GeneratedServerIcon seed={displayName || host} /> : "S"}
              />
              {canEdit && (
                <div className="flex items-center justify-center" style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--gryt-accent-9)",
                    color: "var(--gryt-on-accent)",
                    boxShadow: "0 1px 4px var(--gryt-neutral-a5)",
                  }}>
                  <PiCameraFill size={14} />
                </div>
              )}
            </div>
          </button>
          <span className="text-xs">
            {isUploadingIcon
              ? "Uploading..."
              : isClearingIcon
                ? "Clearing..."
                : canEdit
                  ? "Click to change icon"
                  : "Server icon"}
          </span>
        </div>

        {canEdit && iconUrl ? (
          <>
            <Button size="small"
              disabled={isUploadingIcon || isClearingIcon}
              onClick={() => setShowClearIconConfirm(true)}
              style={{ alignSelf: "center" }}
            >
              <PiTrashFill size={16} />
              Clear icon
            </Button>
            <AlertDialog.Root
              open={showClearIconConfirm}
              onOpenChange={(open) => { if (!open) setShowClearIconConfirm(false); }}
            >
              <AlertDialog.Portal>
                <AlertDialog.Backdrop />
                <AlertDialog.Popup>
                <AlertDialog.Title>Clear server icon?</AlertDialog.Title>
                <AlertDialog.Description>
                  This will remove the current server icon. You can upload a new one at any time.
                </AlertDialog.Description>
                <div className="flex gap-3 mt-4 justify-end">
                  <AlertDialog.Close
                    render={
                      <Button size="small">Cancel</Button>
                    }
                  />
                  <AlertDialog.Close
                    render={
                      <Button size="small"
                        onClick={() => { clearIcon(); setShowClearIconConfirm(false); }}
                      >
                        Clear icon
                      </Button>
                    }
                  />
                </div>
              </AlertDialog.Popup>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          </>
        ) : null}
        <input
          ref={iconInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          style={{ display: "none" }}
          disabled={!canEdit || isUploadingIcon || isClearingIcon}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadIcon(f);
            e.currentTarget.value = "";
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Limits (optional)
        </span>
        <span className="text-sm">
          Leave blank for defaults. These affect uploads and voice bandwidth.
        </span>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Max avatar upload (MB)
          </span>
          <TextField
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={avatarMaxMb}
            onChange={(e) => setAvatarMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ avatarMaxBytes: parseMbToBytes(avatarMaxMb) })}
            placeholder="e.g. 5"
            disabled={!canEdit}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Max file upload (MB)
          </span>
          <TextField
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            value={uploadMaxMb}
            onChange={(e) => setUploadMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ uploadMaxBytes: parseMbToBytes(uploadMaxMb) })}
            placeholder="e.g. 25"
            disabled={!canEdit}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">
            Max emoji upload (MB)
          </span>
          <TextField
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={emojiMaxMb}
            onChange={(e) => setEmojiMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ emojiMaxBytes: parseMbToBytes(emojiMaxMb) })}
            placeholder="e.g. 5"
            disabled={!canEdit}
          />
        </div>

      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Profanity filter
        </span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>
          Controls how profane messages are handled on this server.
        </span>
        <div className="flex gap-2 flex-wrap">
          <div style={{ flex: "1 1 180px" }}>
            <Select
              value={profanityMode}
              onValueChange={(v) => {
                const mode = v as ProfanityMode;
                setProfanityMode(mode);
                saveIfChanged({ profanityMode: mode });
              }}
              disabled={!canEdit}
              options={[
                { label: "Off — no filtering", value: "off" },
                {
                  label: "Flag — blur profanity (clients can reveal)",
                  value: "flag",
                },
                { label: "Censor — replace profanity", value: "censor" },
                { label: "Block — reject message entirely", value: "block" },
              ]}
            />
          </div>
          {profanityMode === "censor" && (
            <div style={{ flex: "1 1 180px" }}>
              <Select
                value={censorStyle}
                onValueChange={(v) => {
                  const style = v as CensorStyle;
                  setCensorStyle(style);
                  saveIfChanged({ profanityCensorStyle: style });
                }}
                disabled={!canEdit}
                placeholder="Replacement style"
                options={[
                  { label: "Symbols — $#@!%&*", value: "grawlix" },
                  { label: "Asterisks — ****", value: "asterisks" },
                  { label: "Swear emoji — 🤬🤬", value: "emoji" },
                  { label: "Black bars — ████", value: "block" },
                  { label: "Hearts — ♥♥♥♥", value: "hearts" },
                ]}
              />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          System messages channel
        </span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>
          Choose which text channel receives system messages like &ldquo;user joined&rdquo; and &ldquo;user left&rdquo;.
        </span>
        <Select
          className="max-w-80"
          value={systemChannelId ?? "__auto__"}
          onValueChange={(v) => {
            const id = v === "__auto__" ? null : String(v);
            setSystemChannelId(id);
            saveIfChanged({ systemChannelId: id });
          }}
          disabled={!canEdit}
          options={[
            { label: "Auto (first text channel)", value: "__auto__" },
            ...textChannels.map((ch) => ({ label: `#${ch.name}`, value: ch.id })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Who can join
        </span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>
          Bans still apply whichever of these you pick, but they hold only as
          well as the identity behind them — somebody without a Gryt account can
          make a new one, so lean on invites if that matters.
        </span>
        <Select
          className="max-w-80"
          value={joinPolicy}
          onValueChange={(v) => {
            const next = normalizeJoinPolicy(String(v));
            const previous = joinPolicy;
            setJoinPolicy(next);
            if (!saveIfChanged({ joinPolicy: next })) setJoinPolicy(previous);
          }}
          disabled={!canEdit}
          options={[
            { label: "With an invite", value: "invite" },
            { label: "After you let them in", value: "request" },
            { label: "Anyone, no invite", value: "open" },
          ]}
        />
        {joinPolicy === "request" && (
          <span className="text-xs" style={{ lineHeight: 1.4 }}>
            People who ask show up under <strong>Requests</strong>. Nobody gets in
            until somebody there approves them.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          LAN access
        </span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>
          When enabled, clients on the same local network can join without an invite code. Remote connections still require an invite.
        </span>
        <div className="flex items-center gap-2">
          <Switch
            checked={lanOpen}
            onCheckedChange={(v) => {
              setLanOpen(v);
              if (!saveIfChanged({ lanOpen: v })) setLanOpen(!v);
            }}
            disabled={!canEdit}
          />
          <span className="text-sm">Allow anyone on LAN to join</span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">
          Discoverability
        </span>
        <span className="text-xs" style={{ lineHeight: 1.4 }}>
          When disabled, the server&rsquo;s public info endpoint is hidden. Non-members will not be able to see the server name, description, or member count before joining.
        </span>
        <div className="flex items-center gap-2">
          <Switch
            checked={discoverable}
            onCheckedChange={(v) => {
              setDiscoverable(v);
              if (!saveIfChanged({ discoverable: v })) setDiscoverable(!v);
            }}
            disabled={!canEdit}
          />
          <span className="text-sm">Allow public server info</span>
        </div>
      </div>

      {autosaving ? (
        <div className="flex justify-end">
          <span className="text-sm">Saving…</span>
        </div>
      ) : null}
    </div>
  );
}

