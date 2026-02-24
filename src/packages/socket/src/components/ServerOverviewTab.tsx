import {
  AlertDialog,
  Avatar,
  Button,
  Flex,
  IconButton,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MdCameraAlt, MdClose, MdDelete, MdVisibility, MdVisibilityOff } from "react-icons/md";

import { getServerAccessToken, getServerHttpBase, getValidIdentityToken } from "@/common";
import { useSettings } from "@/settings";

type ProfanityMode = "off" | "flag" | "censor" | "block";
type CensorStyle = "grawlix" | "emoji" | "asterisks" | "block" | "hearts";

type ServerSettingsPayload = {
  serverId: string;
  isOwner: boolean;
  isConfigured: boolean;
  displayName: string;
  description: string;
  iconUrl: string | null;
  hasPassword: boolean;
  avatarMaxBytes?: number | null;
  uploadMaxBytes?: number | null;
  emojiMaxBytes?: number | null;
  profanityMode?: ProfanityMode;
  profanityCensorStyle?: CensorStyle;
};

export type ServerOverviewInitialSettings = {
  displayName?: string;
  description?: string;
  hasPassword?: boolean;
};

export function ServerOverviewTab({
  host,
  socket,
  accessToken,
  initialSettings,
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
}) {
  const { nickname } = useSettings();

  const MAX_ICON_SIZE_BYTES = 25 * 1024 * 1024;

  const [isOwner, setIsOwner] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isClearingIcon, setIsClearingIcon] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconCacheBuster, setIconCacheBuster] = useState(0);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const [showClearIconConfirm, setShowClearIconConfirm] = useState(false);

  const iconBusy = isUploadingIcon || isClearingIcon;

  const [profanityMode, setProfanityMode] = useState<ProfanityMode>("censor");
  const [censorStyle, setCensorStyle] = useState<CensorStyle>("emoji");

  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
  } | null>(null);

  const [avatarMaxMb, setAvatarMaxMb] = useState<string>("");
  const [uploadMaxMb, setUploadMaxMb] = useState<string>("");
  const [emojiMaxMb, setEmojiMaxMb] = useState<string>("");

  const effectiveAccessToken = useMemo(() => accessToken || getServerAccessToken(host), [accessToken, host]);

  // Apply any initial settings when host changes (best-effort prefill).
  useEffect(() => {
    setPassword("");
    setClearPassword(false);
    if (!initialSettings) return;
    if (typeof initialSettings.displayName === "string") setDisplayName(initialSettings.displayName);
    if (typeof initialSettings.description === "string") setDescription(initialSettings.description);
    if (typeof initialSettings.hasPassword === "boolean") setHasPassword(initialSettings.hasPassword);
  }, [host, initialSettings]);

  const isServerSettingsPayload = (x: unknown): x is ServerSettingsPayload => {
    if (!x || typeof x !== "object") return false;
    const p = x as Partial<ServerSettingsPayload>;
    return typeof p.serverId === "string" &&
      typeof p.isOwner === "boolean" &&
      typeof p.isConfigured === "boolean" &&
      typeof p.displayName === "string" &&
      typeof p.description === "string" &&
      typeof p.hasPassword === "boolean";
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
      setHasPassword(!!payload.hasPassword);
      setIconUrl(payload.iconUrl || null);

      const toMbString = (bytes?: number | null) => {
        if (!bytes || !Number.isFinite(bytes)) return "";
        const mb = bytes / (1024 * 1024);
        return (Math.round(mb * 10) / 10).toString();
      };

      setProfanityMode(payload.profanityMode ?? "censor");
      setCensorStyle(payload.profanityCensorStyle ?? "emoji");

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
      };
    };

    socket.on("server:settings", onSettings);
    socket.emit("server:settings:get");

    return () => {
      socket.off("server:settings", onSettings);
    };
  }, [host, socket]);


  const ensureJoined = async () => {
    if (!socket?.connected) return;
    if (!nickname) return;
    const identityToken = await getValidIdentityToken().catch(() => undefined);
    socket.emit("server:join", { password: "", nickname, identityToken });
  };

  const parseMbToBytes = (s: string): number | null => {
    const raw = (s || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n * 1024 * 1024);
  };
  const emitSettingsUpdate = async (patch: Partial<{
    displayName: string;
    description: string;
    avatarMaxBytes: number | null;
    uploadMaxBytes: number | null;
    emojiMaxBytes: number | null;
    profanityMode: ProfanityMode;
    profanityCensorStyle: CensorStyle;
  }>) => {
    if (!host) return;
    if (!socket || !socket.connected) return;
    if (!effectiveAccessToken) { await ensureJoined(); return; }
    if (!isOwner) return;

    // Update lastSettingsRef immediately so subsequent blur events
    // correctly detect "no change" and don't double-save.
    if (lastSettingsRef.current) {
      lastSettingsRef.current = { ...lastSettingsRef.current, ...patch };
    }

    pendingSaveCountRef.current += 1;
    setAutosaving(true);
    socket.emit("server:settings:update", {
      accessToken: effectiveAccessToken,
      ...patch,
    });
  };

  const saveIfChanged = (patch: Parameters<typeof emitSettingsUpdate>[0]) => {
    const last = lastSettingsRef.current;
    if (last) {
      const entries = Object.entries(patch) as Array<[keyof typeof patch, string | number | null | undefined]>;
      const changed = entries.some(([k, v]) => last[k] !== v);
      if (!changed) return;
    }
    emitSettingsUpdate(patch).catch(() => undefined);
  };

  const submit = async () => {
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
      toast.error("Only the server owner can change settings.");
      return;
    }

    setSubmitting(true);
    try {
      socket.emit("server:settings:update", {
        accessToken: effectiveAccessToken,
        displayName: displayName.trim(),
        description: description.trim(),
        ...(clearPassword ? { clearPassword: true } : {}),
        ...(password.trim().length > 0 ? { password: password.trim() } : {}),
        avatarMaxBytes: parseMbToBytes(avatarMaxMb),
        uploadMaxBytes: parseMbToBytes(uploadMaxMb),
        emojiMaxBytes: parseMbToBytes(emojiMaxMb),
      });
      toast.success("Server settings saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update settings");
    } finally {
      setSubmitting(false);
    }
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
          ? "Update the server display name, icon and password."
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
          disabled={submitting || !isOwner}
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
          disabled={submitting || !isOwner}
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
            disabled={!isOwner || iconBusy || submitting}
            onClick={() => iconInputRef.current?.click()}
            aria-label="Change server icon"
            style={{
              all: "unset",
              cursor: isOwner && !iconBusy && !submitting ? "pointer" : "default",
              borderRadius: 9999,
            }}
          >
            <div style={{ position: "relative" }}>
              <Avatar
                size="7"
                radius="full"
                src={iconUrl ? `${getServerHttpBase(host)}/icon?v=${iconCacheBuster}` : undefined}
                fallback={displayName?.[0]?.toUpperCase() || "S"}
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
                  <MdCameraAlt size={14} />
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
              disabled={submitting || isUploadingIcon || isClearingIcon}
              onClick={() => setShowClearIconConfirm(true)}
              style={{ alignSelf: "center" }}
            >
              <MdDelete size={16} />
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
          disabled={submitting || !isOwner || isUploadingIcon || isClearingIcon}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadIcon(f);
            e.currentTarget.value = "";
          }}
        />
      </Flex>

      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Server password
        </Text>
        <TextField.Root
          type={showPassword ? "text" : "password"}
          value={clearPassword ? "" : password}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (clearPassword) setClearPassword(false);
            setPassword(e.target.value);
          }}
          placeholder={clearPassword ? "Password will be cleared" : hasPassword ? "Enter new password to change" : "Set a password"}
          disabled={submitting || !isOwner || clearPassword}
        >
          <TextField.Slot side="right">
            <Flex align="center" gap="1">
              {hasPassword && !clearPassword && (
                <IconButton
                  size="1"
                  variant="ghost"
                  color="red"
                  onClick={() => { setClearPassword(true); setPassword(""); }}
                  disabled={submitting || !isOwner}
                  title="Clear password"
                  style={{ cursor: "pointer" }}
                >
                  <MdClose size={14} />
                </IconButton>
              )}
              {clearPassword && (
                <IconButton
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() => setClearPassword(false)}
                  disabled={submitting || !isOwner}
                  title="Cancel clear"
                  style={{ cursor: "pointer" }}
                >
                  <Text size="1">Undo</Text>
                </IconButton>
              )}
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => setShowPassword((v) => !v)}
                disabled={submitting || !isOwner}
                title={showPassword ? "Hide password" : "Show password"}
                style={{ cursor: "pointer" }}
              >
                {showPassword ? <MdVisibilityOff size={14} /> : <MdVisibility size={14} />}
              </IconButton>
            </Flex>
          </TextField.Slot>
        </TextField.Root>
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
            disabled={submitting || !isOwner}
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
            disabled={submitting || !isOwner}
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
            disabled={submitting || !isOwner}
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
              disabled={submitting || !isOwner}
            >
              <Select.Trigger style={{ width: "100%" }} />
              <Select.Content>
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
                disabled={submitting || !isOwner}
              >
                <Select.Trigger style={{ width: "100%" }} placeholder="Replacement style" />
                <Select.Content>
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

      {(password.trim().length > 0 || clearPassword) ? (
        <Flex justify="end" gap="2">
          <Button onClick={submit} disabled={submitting || !isOwner}>
            Save Password
          </Button>
        </Flex>
      ) : autosaving ? (
        <Flex justify="end">
          <Text size="2" color="gray">Saving…</Text>
        </Flex>
      ) : null}
    </Flex>
  );
}

