import { Cross2Icon, GearIcon } from "@radix-ui/react-icons";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { FiEye, FiEyeOff } from "react-icons/fi";

import { getServerAccessToken, getServerHttpBase, getValidIdentityToken } from "@/common";
import { useSettings } from "@/settings";

import { useSockets } from "../hooks/useSockets";

type SetupRequiredDetail = {
  host: string;
  serverId?: string;
  settings?: {
    displayName?: string;
    description?: string;
    iconUrl?: string | null;
    hasPassword?: boolean;
    isConfigured?: boolean;
  };
};

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
};

export function ServerSetupModal() {
  const { sockets } = useSockets();
  const { nickname } = useSettings();

  const MAX_ICON_SIZE_BYTES = 25 * 1024 * 1024;

  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState<string>("");

  const [isOwner, setIsOwner] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);

  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);

  const close = () => {
    if (submitting) return;
    setIsOpen(false);
    setPassword("");
    setClearPassword(false);
  };

  // Open from auto-setup prompt
  useEffect(() => {
    const handler = (event: CustomEvent<SetupRequiredDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setIsOpen(true);

      const s = event.detail?.settings;
      if (s?.displayName) setDisplayName(s.displayName);
      if (typeof s?.description === "string") setDescription(s.description);
      if (typeof s?.hasPassword === "boolean") setHasPassword(s.hasPassword);
    };
    window.addEventListener("server_setup_required", handler as EventListener);
    return () => window.removeEventListener("server_setup_required", handler as EventListener);
  }, []);

  // Open from menu click
  useEffect(() => {
    const handler = (event: CustomEvent<{ host: string }>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      setIsOpen(true);
    };
    window.addEventListener("server_settings_open", handler as EventListener);
    return () => window.removeEventListener("server_settings_open", handler as EventListener);
  }, []);

  // When opened, fetch current settings and keep state in sync.
  useEffect(() => {
    if (!isOpen || !host) return;
    if (!socket) return;

    const onSettings = (payload: ServerSettingsPayload) => {
      setIsOwner(!!payload.isOwner);
      setDisplayName(payload.displayName || "");
      setDescription(payload.description || "");
      setHasPassword(!!payload.hasPassword);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("server:settings", onSettings as any);
    socket.emit("server:settings:get");

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("server:settings", onSettings as any);
    };
  }, [isOpen, host, socket]);

  const submit = async () => {
    if (!host) return;
    if (!socket || !socket.connected) {
      toast.error("Not connected to the server.");
      return;
    }
    const accessToken = getServerAccessToken(host);
    if (!accessToken) {
      // Try to re-join automatically instead of only warning.
      if (socket && socket.connected && nickname) {
        (async () => {
          const identityToken = await getValidIdentityToken().catch(() => undefined);
          socket.emit("server:join", { password: "", nickname, identityToken });
        })();
      }
      return;
    }
    if (!isOwner) {
      toast.error("Only the server owner can change settings.");
      return;
    }

    setSubmitting(true);
    try {
      socket.emit("server:settings:update", {
        accessToken,
        displayName: displayName.trim(),
        description: description.trim(),
        ...(clearPassword ? { clearPassword: true } : {}),
        ...(password.trim().length > 0 ? { password: password.trim() } : {}),
      });
      toast.success("Server settings saved");
      close();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update settings");
    } finally {
      setSubmitting(false);
    }
  };

  const uploadIcon = async (file: File) => {
    if (!host) return;
    const accessToken = getServerAccessToken(host);
    if (!accessToken) {
      if (socket && socket.connected && nickname) {
        (async () => {
          const identityToken = await getValidIdentityToken().catch(() => undefined);
          socket.emit("server:join", { password: "", nickname, identityToken });
        })();
      }
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
          Authorization: `Bearer ${accessToken}`,
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
      socket?.emit("server:settings:get");
      socket?.emit("server:details");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Icon upload failed");
    } finally {
      setIsUploadingIcon(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : close())}>
      <Dialog.Content style={{ maxWidth: 640 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <GearIcon />
              <Dialog.Title>Server settings</Dialog.Title>
            </Flex>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={close} disabled={submitting}>
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>

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
              placeholder="A place to hang out"
              disabled={submitting || !isOwner}
              style={{ minHeight: 90 }}
            />
          </Flex>

          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              Server icon
            </Text>
            <Text size="2" color="gray">
              Upload a square image (we'll crop/resize it). PNG/JPEG/WebP/GIF/AVIF up to 25MB. This updates `https://{host}/icon`.
            </Text>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              disabled={submitting || !isOwner || isUploadingIcon}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadIcon(f);
                e.currentTarget.value = "";
              }}
            />
            {isUploadingIcon ? (
              <Text size="2" color="gray">
                Uploading...
              </Text>
            ) : null}
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
                      <Cross2Icon width={14} height={14} />
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
                    {showPassword ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                  </IconButton>
                </Flex>
              </TextField.Slot>
            </TextField.Root>
          </Flex>

          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={close} disabled={submitting}>
              Close
            </Button>
            <Button onClick={submit} disabled={submitting || !isOwner}>
              Save
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

