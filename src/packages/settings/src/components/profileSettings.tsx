import { Avatar, TextField } from "@gryt/ui";
import { AlertDialog, Button, Flex, Heading, IconButton, SegmentedControl, Text, Tooltip } from "@radix-ui/themes";
import { useCallback,useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiArrowsClockwiseFill, PiCameraFill, PiCheck, PiCopyFill } from "react-icons/pi";

import { compressStaticAvatarToLimit, getAvatarHash, getServerAccessToken, getServerHttpBase, getStoredAvatar, getUploadsFileUrl, resolveAvatarSrc, useUserId } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import { SettingsContainer } from "./settingsComponents";

function extForMime(mime: string): string {
  switch ((mime || "").toLowerCase()) {
    case "image/gif": return "gif";
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    default: return "bin";
  }
}

async function uploadAvatarToHost(host: string, file: Blob): Promise<{ avatarFileId?: string; processing?: boolean }> {
  const token = getServerAccessToken(host);
  if (!token) throw new Error("Not authenticated with this server. Try reconnecting.");
  const form = new FormData();
  const ext = extForMime(file.type || "");
  form.append("file", file, `avatar.${ext}`);
  const base = getServerHttpBase(host);
  const r = await fetch(`${base}/api/uploads/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const raw = await r.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!r.ok) {
    const msg =
      (typeof data?.message === "string" && data.message.trim().length > 0)
        ? data.message
        : (typeof data?.error === "string" && data.error.trim().length > 0)
          ? data.error
          : (raw && raw.trim().length > 0)
            ? raw.trim()
            : `HTTP ${r.status} ${r.statusText || ""}`.trim();
    throw new Error(msg);
  }
  return (data || {}) as { avatarFileId?: string; processing?: boolean };
}

async function removeAvatarFromHost(host: string): Promise<void> {
  const token = getServerAccessToken(host);
  if (!token) throw new Error("Not authenticated with this server. Try reconnecting.");
  const base = getServerHttpBase(host);
  const r = await fetch(`${base}/api/uploads/avatar`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const raw = await r.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!r.ok) {
    const msg =
      (typeof data?.message === "string" && data.message.trim().length > 0)
        ? data.message
        : (typeof data?.error === "string" && data.error.trim().length > 0)
          ? data.error
          : (raw && raw.trim().length > 0)
            ? raw.trim()
            : `HTTP ${r.status} ${r.statusText || ""}`.trim();
    throw new Error(msg);
  }
}

interface ProfileEditorProps {
  nickname: string;
  avatarUrl: string | null;
  /** Shown when there is no uploaded avatar. Kept separate from avatarUrl so
   *  "Remove avatar" still keys off whether one was actually uploaded — a
   *  generated face is not something there is anything to remove. */
  generatedAvatarUrl?: string;
  initial: string;
  uploading: boolean;
  removing: boolean;
  onSaveNickname: (name: string) => void;
  onPickAvatar: () => void;
  onRemoveAvatar: () => void;
  serverLabel?: string;
  /** Set only on a per-server tab. Distinct from serverLabel, which the All
   *  Servers tab also uses for its own heading. */
  scopedToServer?: string;
}

function ProfileEditor({
  nickname,
  avatarUrl,
  generatedAvatarUrl,
  initial,
  uploading,
  removing,
  onSaveNickname,
  onPickAvatar,
  onRemoveAvatar,
  serverLabel,
  scopedToServer,
}: ProfileEditorProps) {
  const [draft, setDraft] = useState(nickname);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  // Drawn from what is in the box, not from what is saved. The nickname is the
  // seed, so typing a new one is the only way to see what you are about to look
  // like — and finding that out after saving is a worse way to choose a name.
  const previewSrc = avatarUrl || resolveAvatarSrc(undefined, draft) || generatedAvatarUrl;

  useEffect(() => {
    setDraft(nickname);
  }, [nickname]);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim().substring(0, 20);
    if (trimmed.length > 0 && trimmed !== nickname) {
      onSaveNickname(trimmed);
      setDraft(trimmed);
    }
  }, [draft, nickname, onSaveNickname]);

  return (
    <Flex
      direction="column"
      gap="5"
      align="center"
      style={{ paddingTop: 8 }}
      data-tour="profile-editor"
    >
      {serverLabel && (
        <Text size="2" weight="medium">
          {serverLabel}
        </Text>
      )}

      <Flex
        direction="column"
        align="center"
        gap="2"
        style={{ cursor: "default", opacity: uploading || removing ? 0.6 : 1, transition: "opacity 200ms" }}
      >
        <button
          type="button"
          disabled={uploading || removing}
          onClick={onPickAvatar}
          aria-label="Change avatar"
          style={{
            all: "unset",
            cursor: uploading || removing ? "default" : "pointer",
            borderRadius: 9999,
          }}
        >
          <div style={{ position: "relative" }}>
            <Avatar
              size="large"
              className="h-24 w-24 text-3xl"
              src={previewSrc}
              fallback={initial}
            />
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
          </div>
        </button>
        <Text size="1">
          {uploading ? "Uploading..." : removing ? "Removing..." : "Click to change avatar"}
        </Text>
      </Flex>

      {avatarUrl ? (
        <>
          <Button
            disabled={uploading || removing}
            onClick={() => setShowRemoveConfirm(true)}
          >
            Remove avatar
          </Button>
          <AlertDialog.Root open={showRemoveConfirm} onOpenChange={(open) => { if (!open) setShowRemoveConfirm(false); }}>
            <AlertDialog.Content maxWidth="420px">
              <AlertDialog.Title>Remove avatar?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                Your avatar will be removed{serverLabel ? ` from ${serverLabel}` : ""}. This action cannot be undone.
              </AlertDialog.Description>
              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button>Cancel</Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action>
                  <Button variant="solid" onClick={() => { onRemoveAvatar(); setShowRemoveConfirm(false); }}>Remove</Button>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </>
      ) : null}

      <Flex align="center" justify="center" style={{ width: "100%" }}>
        <Flex direction="column" gap="2" style={{ maxWidth: 400, width: "100%" }}>
          <Text weight="medium" size="2">
            Nickname
          </Text>
          {/*
            On a server tab this is a statement of fact — the value comes from
            that server's member list, so it is literally what everyone there
            sees. On the All Servers tab it is not: that is the local default
            applied to servers you join next, and it only reaches the servers
            you are already on when you press Sync. Saying "will see you" in
            both places is what let a local name of "Sivert" sit next to a
            server holding "Unknown" without anything looking wrong.
          */}
          <Text size="1">
            {scopedToServer
              ? `This is how other people on ${scopedToServer} see you.`
              : "Used on servers you join from now on. Use Sync to apply it to servers you are already on."}
          </Text>
          <TextField
            placeholder="Enter a nickname"
            maxLength={20}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleSave}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSave();
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
        </Flex>
      </Flex>
    </Flex>
  );
}

export function ProfileSettings() {
  const userId = useUserId();
  const { nickname, setNickname, avatarDataUrl, setAvatarDataUrl, setAvatarFile } =
    useSettings();
  const { servers } = useServerManagement();
  const { sockets, serverDetailsList, serverProfiles, setServerProfiles } = useSockets();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const serverHosts = Object.keys(servers);
  const connectedHosts = serverHosts.filter(h => sockets[h]?.connected);
  const [selectedTab, setSelectedTab] = useState("all");
  const pendingActionRef = useRef<{ type: "pick" | "remove"; host: string | null }>({ type: "pick", host: null });

  const getAvatarMaxBytes = (hosts: string[]) => {
    const defaultMax = 5 * 1024 * 1024;
    return hosts.reduce((min, h) => {
      const v = serverDetailsList?.[h]?.server_info?.avatar_max_bytes;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.min(min, v);
      return min;
    }, defaultMax);
  };

  const processAndUpload = async (file: File, hosts: string[]) => {
    const minAvatarMaxBytes = getAvatarMaxBytes(hosts);

    if (file.size > 25 * 1024 * 1024) {
      toast.error("Avatar file too large (max 25MB).");
      return;
    }

    let uploadFile: File = file;

    const isAnimatedFormat = ["image/gif", "image/webp"].includes((file.type || "").toLowerCase());
    if (!isAnimatedFormat) {
      try {
        const blob = await compressStaticAvatarToLimit(file, { maxBytes: minAvatarMaxBytes, sizePx: 256 });
        if (blob instanceof Blob) {
          const ext = extForMime(blob.type || file.type || "");
          uploadFile = new File([blob], `avatar.${ext}`, { type: blob.type || file.type });
        }
      } catch {
        uploadFile = file;
      }
    }

    setUploading(true);
    try {
      if (hosts.length === 0) {
        await setAvatarFile(uploadFile);
        toast("Avatar updated locally (no servers connected).");
        return;
      }

      const [results, uploadHash] = await Promise.all([
        Promise.allSettled(hosts.map((h) => uploadAvatarToHost(h, uploadFile))),
        getAvatarHash(uploadFile).catch(() => null),
      ]);

      const failed: Array<{ host: string; reason: string }> = [];
      let anySuccess = false;
      let anyProcessing = false;

      results.forEach((r, idx) => {
        const host = hosts[idx];
        if (r.status !== "fulfilled") {
          const reason =
            r.reason instanceof Error
              ? r.reason.message
              : (typeof r.reason === "string" ? r.reason : "Upload failed");
          failed.push({ host, reason });
          return;
        }

        anySuccess = true;
        if (r.value.processing) anyProcessing = true;
        if (r.value.avatarFileId) {
          localStorage.setItem(`avatarFileId:${host}`, r.value.avatarFileId);
          if (uploadHash) localStorage.setItem(`avatarHash:${host}`, uploadHash);
          setServerProfiles(prev => ({
            ...prev,
            [host]: {
              ...prev[host],
              avatarFileId: r.value.avatarFileId!,
              avatarUrl: getUploadsFileUrl(host, r.value.avatarFileId!),
            },
          }));
        }
        sockets[host]?.emit("avatar:updated");
        sockets[host]?.emit("members:fetch");
      });

      if (anySuccess) {
        await setAvatarFile(uploadFile);
      }

      if (failed.length > 0) {
        if (hosts.length === 1) {
          toast.error(`Avatar upload failed: ${failed[0].reason}`);
        } else {
          toast.error(`Avatar upload failed for ${failed.length}/${hosts.length} servers`);
        }
      } else if (anySuccess && anyProcessing) {
        toast("Your avatar has been uploaded. It's being processed by the server \u2014 once done, your avatar will be animated.");
      } else if (anySuccess) {
        toast.success("Avatar updated");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAvatar = async (hosts: string[]) => {
    if (uploading || removing) return;

    setRemoving(true);
    try {
      if (hosts.length === 0) {
        await setAvatarFile(null);
        setAvatarDataUrl(null);
        toast("Avatar removed locally.");
        return;
      }

      const results = await Promise.allSettled(hosts.map((h) => removeAvatarFromHost(h)));

      const failed: Array<{ host: string; reason: string }> = [];
      let anySuccess = false;

      results.forEach((r, idx) => {
        const host = hosts[idx];
        if (r.status !== "fulfilled") {
          const reason =
            r.reason instanceof Error
              ? r.reason.message
              : (typeof r.reason === "string" ? r.reason : "Remove failed");
          failed.push({ host, reason });
          return;
        }
        anySuccess = true;
        localStorage.removeItem(`avatarHash:${host}`);
        localStorage.removeItem(`avatarFileId:${host}`);
        setServerProfiles(prev => ({
          ...prev,
          [host]: {
            ...prev[host],
            avatarFileId: null,
            avatarUrl: null,
          },
        }));
        sockets[host]?.emit("avatar:updated");
        sockets[host]?.emit("members:fetch");
      });

      if (!anySuccess) {
        toast.error(failed.length === 1 ? `Remove avatar failed: ${failed[0].reason}` : "Remove avatar failed");
        return;
      }

      if (hosts.length === serverHosts.length) {
        await setAvatarFile(null);
        setAvatarDataUrl(null);
      }

      if (failed.length > 0) {
        toast.error(`Removed avatar, but failed on ${failed.length}/${hosts.length} servers`);
      } else {
        toast.success("Avatar removed");
      }
    } finally {
      setRemoving(false);
    }
  };

  const handleSaveNickname = (name: string, hosts: string[]) => {
    setNickname(name);
    hosts.forEach(host => {
      sockets[host]?.emit("profile:update", { nickname: name });
      setServerProfiles(prev => ({
        ...prev,
        [host]: {
          ...prev[host],
          nickname: name,
        },
      }));
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      e.target.value = "";
      return;
    }

    const action = pendingActionRef.current;
    const hosts = action.host ? [action.host] : serverHosts;
    await processAndUpload(file, hosts);
    e.target.value = "";
  };

  const triggerFilePick = (host: string | null) => {
    pendingActionRef.current = { type: "pick", host };
    fileInputRef.current?.click();
  };

  const handleSyncToAll = async () => {
    if (syncing || connectedHosts.length === 0) return;
    setSyncing(true);

    try {
      const hosts = connectedHosts;

      hosts.forEach(host => {
        sockets[host]?.emit("profile:update", { nickname });
        setServerProfiles(prev => ({
          ...prev,
          [host]: { ...prev[host], nickname },
        }));
      });

      const stored = userId ? await getStoredAvatar(userId).catch(() => null) : null;
      if (stored?.blob) {
        const minMax = getAvatarMaxBytes(hosts);
        let uploadFile: Blob = stored.blob;

        if ((stored.mime || "").toLowerCase() !== "image/gif") {
          try {
            const compressed = await compressStaticAvatarToLimit(stored.blob as File, { maxBytes: minMax, sizePx: 256 });
            if (compressed instanceof Blob) uploadFile = compressed;
          } catch { /* use original */ }
        }

        const [results, uploadHash] = await Promise.all([
          Promise.allSettled(hosts.map(h => uploadAvatarToHost(h, uploadFile))),
          getAvatarHash(uploadFile).catch(() => null),
        ]);

        let avatarFailed = 0;
        results.forEach((r, idx) => {
          const host = hosts[idx];
          if (r.status !== "fulfilled") {
            avatarFailed++;
            return;
          }
          if (r.value.avatarFileId) {
            localStorage.setItem(`avatarFileId:${host}`, r.value.avatarFileId);
            if (uploadHash) localStorage.setItem(`avatarHash:${host}`, uploadHash);
            setServerProfiles(prev => ({
              ...prev,
              [host]: {
                ...prev[host],
                avatarFileId: r.value.avatarFileId!,
                avatarUrl: getUploadsFileUrl(host, r.value.avatarFileId!),
              },
            }));
          }
          sockets[host]?.emit("avatar:updated");
          sockets[host]?.emit("members:fetch");
        });

        if (avatarFailed > 0) {
          toast.error(`Synced, but avatar failed on ${avatarFailed}/${hosts.length} server${hosts.length > 1 ? "s" : ""}`);
        } else {
          toast.success(`Profile synced to ${hosts.length} server${hosts.length > 1 ? "s" : ""}`);
        }
      } else {
        // No avatar here means every server should end up with none. Syncing
        // only the nickname left servers holding an avatar this profile no
        // longer has, and "sync" then quietly meant "sync some of it" — the
        // one thing the button cannot mean.
        const results = await Promise.allSettled(hosts.map(h => removeAvatarFromHost(h)));

        let removeFailed = 0;
        results.forEach((r, idx) => {
          const host = hosts[idx];
          if (r.status !== "fulfilled") {
            removeFailed++;
            return;
          }
          localStorage.removeItem(`avatarFileId:${host}`);
          localStorage.removeItem(`avatarHash:${host}`);
          setServerProfiles(prev => ({
            ...prev,
            [host]: { ...prev[host], avatarFileId: null, avatarUrl: null },
          }));
          sockets[host]?.emit("avatar:updated");
          sockets[host]?.emit("members:fetch");
        });

        if (removeFailed > 0) {
          toast.error(`Synced, but the avatar could not be cleared on ${removeFailed}/${hosts.length} server${hosts.length > 1 ? "s" : ""}`);
        } else {
          toast.success(`Profile synced to ${hosts.length} server${hosts.length > 1 ? "s" : ""}`);
        }
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const initial = nickname?.[0]?.toUpperCase() || "?";

  const allServerAvatarUrl = avatarDataUrl;

  return (
    <SettingsContainer>
      <Heading as="h2" size="4">
        Profile
      </Heading>

      {serverHosts.length > 0 && (
        <Flex justify="center" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <SegmentedControl.Root
            value={selectedTab}
            onValueChange={setSelectedTab}
            size="1"
          >
            <SegmentedControl.Item value="all">All Servers</SegmentedControl.Item>
            {serverHosts.map(host => {
              const name = serverDetailsList?.[host]?.server_info?.name || servers[host]?.name || host;
              return (
                <SegmentedControl.Item key={host} value={host}>
                  {name}
                </SegmentedControl.Item>
              );
            })}
          </SegmentedControl.Root>
        </Flex>
      )}

      {selectedTab === "all" ? (
        <>
          <ProfileEditor
            nickname={nickname}
            avatarUrl={allServerAvatarUrl}
            generatedAvatarUrl={resolveAvatarSrc(undefined, nickname)}
            initial={initial}
            uploading={uploading}
            removing={removing}
            onSaveNickname={(name) => handleSaveNickname(name, serverHosts)}
            onPickAvatar={() => triggerFilePick(null)}
            onRemoveAvatar={() => handleRemoveAvatar(serverHosts)}
            serverLabel={serverHosts.length > 0 ? "Changes apply to all servers" : undefined}
          />
          {connectedHosts.length > 0 && (
            <Flex justify="center" style={{ paddingTop: 4 }}>
              <Button
                size="2"
                disabled={syncing || uploading || removing}
                onClick={handleSyncToAll}
              >
                <PiArrowsClockwiseFill size={16} style={syncing ? { animation: "spin 1s linear infinite" } : undefined} />
                {syncing ? "Syncing..." : "Sync to all servers"}
              </Button>
            </Flex>
          )}
        </>
      ) : (
        (() => {
          const host = selectedTab;
          const profile = serverProfiles[host];
          const serverNickname = profile?.nickname || nickname;
          const serverAvatarUrl = profile?.avatarUrl || allServerAvatarUrl;
          const serverInitial = serverNickname?.[0]?.toUpperCase() || "?";
          const serverName = serverDetailsList?.[host]?.server_info?.name || servers[host]?.name || host;

          return (
            <ProfileEditor
              nickname={serverNickname}
              avatarUrl={serverAvatarUrl}
              generatedAvatarUrl={resolveAvatarSrc(undefined, serverNickname)}
              initial={serverInitial}
              uploading={uploading}
              removing={removing}
              onSaveNickname={(name) => handleSaveNickname(name, [host])}
              onPickAvatar={() => triggerFilePick(host)}
              onRemoveAvatar={() => handleRemoveAvatar([host])}
              serverLabel={serverName}
              scopedToServer={serverName}
            />
          );
        })()
      )}

      {userId && (
        <Flex align="center" justify="center" gap="1" style={{ marginTop: "auto", paddingTop: 16 }}>
          <Text size="1" style={{ fontFamily: "var(--code-font-family)", userSelect: "all" }}>
            {userId}
          </Text>
          <Tooltip content={copied ? "Copied!" : "Copy User ID"}>
            <IconButton
              size="1"
              variant="ghost"
              style={{ flexShrink: 0 }}
              onClick={() => {
                navigator.clipboard.writeText(userId).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }, () => toast.error("Failed to copy"));
              }}
            >
              {copied ? <PiCheck size={12} /> : <PiCopyFill size={12} />}
            </IconButton>
          </Tooltip>
        </Flex>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </SettingsContainer>
  );
}
