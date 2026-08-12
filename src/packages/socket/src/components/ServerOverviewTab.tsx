import {
  AlertDialog,
  Avatar,
  Button,
  Flex,
  Select,
  Switch,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiCameraFill, PiTrashFill } from "react-icons/pi";

import { GeneratedServerIcon, getServerAccessToken, getServerHttpBase } from "@/common";
import { useSettings } from "@/settings";
import type { Channel } from "@/settings/src/types/server";

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

  const [isOwner, setIsOwner] = useState(false);
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

      setIsOwner(!!payload.isOwner);
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
    if (!isOwner) {
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
    if (!isOwner) {
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
    if (!isOwner) {
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
    <Flex direction="column" gap="4">
      <Text size="2" color="gray">
        {isOwner
          ? "Update the server display name and icon."
          : "You can view settings, but only the owner can make changes."}
      </Text>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Server
        </Text>
        <Text size="2" color="gray">
          {host}
        </Text>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Display name
        </Text>
        <TextField.Root
          value={displayName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDisplayName(e.target.value)}
          onBlur={() => saveIfChanged({ displayName: displayName.trim() })}
          placeholder="My Gryt Server"
          disabled={!isOwner}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Description
        </Text>
        <TextArea
          value={description}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
          onBlur={() => saveIfChanged({ description: description.trim() })}
          placeholder="A place to hang out"
          disabled={!isOwner}
          style={{ minHeight: 90 }}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Server icon
        </Text>
        {/** Only the avatar is clickable (not whitespace). */}
        <Flex
          direction="column"
          align="center"
          gap="2"
          style={{
            cursor: "default",
            opacity: iconBusy ? 0.6 : 1,
            transition: "opacity 200ms",
            paddingTop: 8,
            paddingBottom: 4,
          }}
        >
          <button
            type="button"
            disabled={!isOwner || iconBusy}
            onClick={() => iconInputRef.current?.click()}
            aria-label="Change server icon"
            style={{
              all: "unset",
              cursor: isOwner && !iconBusy ? "pointer" : "default",
              borderRadius: 9999,
            }}
          >
            <div style={{ position: "relative" }}>
              <Avatar
                size="7"
                radius="full"
                src={iconUrl ? `${getServerHttpBase(host)}/icon?v=${iconCacheBuster}` : undefined}
                fallback={host ? <GeneratedServerIcon host={host} /> : (displayName?.[0]?.toUpperCase() || "S")}
              />
              {isOwner && (
                <Flex
                  align="center"
                  justify="center"
                  style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--accent-9)",
                    color: "var(--accent-contrast)",
                    boxShadow: "0 1px 4px var(--gray-a5)",
                  }}
                >
                  <PiCameraFill size={14} />
                </Flex>
              )}
            </div>
          </button>
          <Text size="1" color="gray">
            {isUploadingIcon
              ? "Uploading..."
              : isClearingIcon
                ? "Clearing..."
                : isOwner
                  ? "Click to change icon"
                  : "Server icon"}
          </Text>
        </Flex>

        {isOwner && iconUrl ? (
          <>
            <Button
              variant="soft"
              color="red"
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
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Clear server icon?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  This will remove the current server icon. You can upload a new one at any time.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">Cancel</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button
                      variant="solid"
                      color="red"
                      onClick={() => { clearIcon(); setShowClearIconConfirm(false); }}
                    >
                      Clear icon
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </>
        ) : null}
        <input
          ref={iconInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          style={{ display: "none" }}
          disabled={!isOwner || isUploadingIcon || isClearingIcon}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadIcon(f);
            e.currentTarget.value = "";
          }}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Limits (optional)
        </Text>
        <Text size="2" color="gray">
          Leave blank for defaults. These affect uploads and voice bandwidth.
        </Text>

        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">
            Max avatar upload (MB)
          </Text>
          <TextField.Root
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={avatarMaxMb}
            onChange={(e) => setAvatarMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ avatarMaxBytes: parseMbToBytes(avatarMaxMb) })}
            placeholder="e.g. 5"
            disabled={!isOwner}
          />
        </Flex>

        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">
            Max file upload (MB)
          </Text>
          <TextField.Root
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            value={uploadMaxMb}
            onChange={(e) => setUploadMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ uploadMaxBytes: parseMbToBytes(uploadMaxMb) })}
            placeholder="e.g. 25"
            disabled={!isOwner}
          />
        </Flex>

        <Flex direction="column" gap="2">
          <Text size="2" weight="medium">
            Max emoji upload (MB)
          </Text>
          <TextField.Root
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={emojiMaxMb}
            onChange={(e) => setEmojiMaxMb(e.target.value)}
            onBlur={() => saveIfChanged({ emojiMaxBytes: parseMbToBytes(emojiMaxMb) })}
            placeholder="e.g. 5"
            disabled={!isOwner}
          />
        </Flex>

      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Profanity filter
        </Text>
        <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
          Controls how profane messages are handled on this server.
        </Text>
        <Flex gap="2" wrap="wrap">
          <div style={{ flex: "1 1 180px" }}>
            <Select.Root
              value={profanityMode}
              onValueChange={(v) => {
                const mode = v as ProfanityMode;
                setProfanityMode(mode);
                saveIfChanged({ profanityMode: mode });
              }}
              disabled={!isOwner}
            >
              <Select.Trigger style={{ width: "100%" }} />
              <Select.Content position="popper" sideOffset={4}>
                <Select.Item value="off">Off — no filtering</Select.Item>
                <Select.Item value="flag">Flag — blur profanity (clients can reveal)</Select.Item>
                <Select.Item value="censor">Censor — replace profanity</Select.Item>
                <Select.Item value="block">Block — reject message entirely</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          {profanityMode === "censor" && (
            <div style={{ flex: "1 1 180px" }}>
              <Select.Root
                value={censorStyle}
                onValueChange={(v) => {
                  const style = v as CensorStyle;
                  setCensorStyle(style);
                  saveIfChanged({ profanityCensorStyle: style });
                }}
                disabled={!isOwner}
              >
                <Select.Trigger style={{ width: "100%" }} placeholder="Replacement style" />
                <Select.Content position="popper" sideOffset={4}>
                  <Select.Item value="grawlix">Symbols — $#@!%&*</Select.Item>
                  <Select.Item value="asterisks">Asterisks — ****</Select.Item>
                  <Select.Item value="emoji">Swear emoji — 🤬🤬</Select.Item>
                  <Select.Item value="block">Black bars — ████</Select.Item>
                  <Select.Item value="hearts">Hearts — ♥♥♥♥</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          )}
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          System messages channel
        </Text>
        <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
          Choose which text channel receives system messages like &ldquo;user joined&rdquo; and &ldquo;user left&rdquo;.
        </Text>
        <Select.Root
          value={systemChannelId ?? "__auto__"}
          onValueChange={(v) => {
            const id = v === "__auto__" ? null : v;
            setSystemChannelId(id);
            saveIfChanged({ systemChannelId: id });
          }}
          disabled={!isOwner}
        >
          <Select.Trigger style={{ width: "100%", maxWidth: 320 }} />
          <Select.Content position="popper" sideOffset={4}>
            <Select.Item value="__auto__">Auto (first text channel)</Select.Item>
            {textChannels.map((ch) => (
              <Select.Item key={ch.id} value={ch.id}>
                #{ch.name}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Who can join
        </Text>
        <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
          Bans still apply whichever of these you pick, but they hold only as
          well as the identity behind them — somebody without a Gryt account can
          make a new one, so lean on invites if that matters.
        </Text>
        <Select.Root
          value={joinPolicy}
          onValueChange={(v) => {
            const next = normalizeJoinPolicy(v);
            const previous = joinPolicy;
            setJoinPolicy(next);
            if (!saveIfChanged({ joinPolicy: next })) setJoinPolicy(previous);
          }}
          disabled={!isOwner}
        >
          <Select.Trigger style={{ width: "100%", maxWidth: 320 }} />
          <Select.Content position="popper" sideOffset={4}>
            <Select.Item value="invite">With an invite</Select.Item>
            <Select.Item value="request">After you let them in</Select.Item>
            <Select.Item value="open">Anyone, no invite</Select.Item>
          </Select.Content>
        </Select.Root>
        {joinPolicy === "request" && (
          <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
            People who ask show up under <strong>Requests</strong>. Nobody gets in
            until somebody there approves them.
          </Text>
        )}
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          LAN access
        </Text>
        <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
          When enabled, clients on the same local network can join without an invite code. Remote connections still require an invite.
        </Text>
        <Flex align="center" gap="2">
          <Switch
            checked={lanOpen}
            onCheckedChange={(v) => {
              setLanOpen(v);
              if (!saveIfChanged({ lanOpen: v })) setLanOpen(!v);
            }}
            disabled={!isOwner}
            size="1"
          />
          <Text size="2">Allow anyone on LAN to join</Text>
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Discoverability
        </Text>
        <Text size="1" color="gray" style={{ lineHeight: 1.4 }}>
          When disabled, the server&rsquo;s public info endpoint is hidden. Non-members will not be able to see the server name, description, or member count before joining.
        </Text>
        <Flex align="center" gap="2">
          <Switch
            checked={discoverable}
            onCheckedChange={(v) => {
              setDiscoverable(v);
              if (!saveIfChanged({ discoverable: v })) setDiscoverable(!v);
            }}
            disabled={!isOwner}
            size="1"
          />
          <Text size="2">Allow public server info</Text>
        </Flex>
      </Flex>

      {autosaving ? (
        <Flex justify="end">
          <Text size="2" color="gray">Saving…</Text>
        </Flex>
      ) : null}
    </Flex>
  );
}

