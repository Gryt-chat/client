import { AlertDialog, Avatar, Button, IconButton, Select, Tabs, TextField, Tooltip } from "@gryt/ui";
import { AvatarChoiceDialog, OwlDesignerDialog } from "@gryt/ui";
import { useCallback,useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { compressStaticAvatarToLimit, getAvatarHash, getServerAccessToken, getServerHttpBase, getStoredAvatar, getStoredWorn, getUploadsFileUrl, resolveAvatarSrc, setStoredWorn, useUserId } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import { PiArrowsClockwiseFill, PiCameraFill, PiCheck, PiCopyFill } from "../../../../lib/icons";
import { SettingsContainer } from "./settingsComponents";

/**
 * How many servers the tab row still holds before it becomes a select.
 *
 * Counts servers, not tabs, so the All Servers tab is the sixth one on screen
 * at the switchover. Five is roughly where the row filled the panel at its
 * normal width — a seventh name was already running off the edge.
 */
const SERVERS_BEFORE_DROPDOWN = 5;

function extForMime(mime: string): string {
  switch ((mime || "").toLowerCase()) {
    case "image/gif": return "gif";
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    default: return "bin";
  }
}

/**
 * What another server gave us, in a format this one will accept.
 *
 * A server stores whatever its image worker produced rather than what was
 * uploaded — ours re-encodes to AVIF — and the upload endpoint does not accept
 * everything it emits. Copying an avatar between servers therefore has to
 * decode and re-encode rather than pass the bytes along: `avatar.bin` with an
 * `image/avif` body comes back 400 invalid_file.
 *
 * Animated formats are passed through untouched. A canvas keeps the first frame
 * and throws the animation away.
 */
async function asUploadableAvatar(blob: Blob): Promise<File> {
  const type = (blob.type || "").toLowerCase();

  if (type === "image/gif" || type === "image/webp") {
    return new File([blob], `avatar.${extForMime(type)}`, { type });
  }

  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas context to read that avatar with");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const png = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!png) throw new Error("could not re-encode that avatar");

  return new File([png], "avatar.png", { type: "image/png" });
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
  /** The designed look, if there is one. Outranks `avatarUrl` — see `resolveAvatarSrc`. */
  worn?: string | null;
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
  worn,
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
  //
  // A designed look is drawn on the draft name too. The look and the seed are
  // separate — the hat stays on when you rename, and the bird under it changes.
  const previewSrc = resolveAvatarSrc(avatarUrl, draft, worn) || generatedAvatarUrl;

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
    <div className="flex flex-col gap-6 items-center" style={{ paddingTop: 8 }} data-tour="profile-editor">
      {serverLabel && (
        <span className="text-sm font-medium">
          {serverLabel}
        </span>
      )}

      <div className="flex flex-col items-center gap-2" style={{ cursor: "default", opacity: uploading || removing ? 0.6 : 1, transition: "opacity 200ms" }}>
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
          </div>
        </button>
        <span className="text-xs">
          {uploading ? "Uploading..." : removing ? "Removing..." : "Click to change avatar"}
        </span>
      </div>

      {avatarUrl ? (
        <>
          <Button size="small"
            disabled={uploading || removing}
            onClick={() => setShowRemoveConfirm(true)}
          >
            Remove avatar
          </Button>
          <AlertDialog.Root open={showRemoveConfirm} onOpenChange={(open) => { if (!open) setShowRemoveConfirm(false); }}>
            <AlertDialog.Portal>
              <AlertDialog.Backdrop />
              <AlertDialog.Popup>
              <AlertDialog.Title>Remove avatar?</AlertDialog.Title>
              <AlertDialog.Description>
                Your avatar will be removed{serverLabel ? ` from ${serverLabel}` : ""}. This action cannot be undone.
              </AlertDialog.Description>
              <div className="flex gap-3 mt-4 justify-end">
                <AlertDialog.Close
                  render={
                    <Button size="small">Cancel</Button>
                  }
                />
                <AlertDialog.Close
                  render={
                    <Button size="small" onClick={() => { onRemoveAvatar(); setShowRemoveConfirm(false); }}>Remove</Button>
                  }
                />
              </div>
            </AlertDialog.Popup>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </>
      ) : null}

      <div className="flex items-center justify-center" style={{ width: "100%" }}>
        <div className="flex flex-col gap-2" style={{ maxWidth: 400, width: "100%" }}>
          <span className="font-medium text-sm">
            Nickname
          </span>
          {/*
            On a server tab this is a statement of fact — the value comes from
            that server's member list, so it is literally what everyone there
            sees. On the All Servers tab it is not: that is the local default
            applied to servers you join next, and it only reaches the servers
            you are already on when you press Sync. Saying "will see you" in
            both places is what let a local name of "Sivert" sit next to a
            server holding "Unknown" without anything looking wrong.
          */}
          <span className="text-xs">
            {scopedToServer
              ? `This is how other people on ${scopedToServer} see you.`
              : "Used on servers you join from now on. Use Sync to apply it to servers you are already on."}
          </span>
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
        </div>
      </div>
    </div>
  );
}

/**
 * What you are doing, in your own words (GRYT-929).
 *
 * Above the server tabs and outside them, because it is not per server. The
 * nickname and the picture are — you can be "Sivert" on one and "S" on another
 * — but this is one line about you that goes everywhere you are joined, and a
 * copy of it per server would be a chore rather than a feature.
 *
 * Saved on blur like every other field here. A server whose role does not allow
 * it refuses quietly; the line simply does not appear there.
 */
function ActivityField() {
  const { activity, setActivity } = useSettings();
  const [draft, setDraft] = useState(activity);

  // Follow the stored value when something else changes it — a plugin setting
  // it, or another window of the same account.
  useEffect(() => setDraft(activity), [activity]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed !== activity) setActivity(trimmed);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-bold">What you are doing</span>
      <span className="text-xs text-gryt-muted">
        Shown under your name on every server you are on. Leave it empty for nothing.
      </span>
      <TextField
        placeholder="Heads down until 3"
        /* The server caps at 96 and truncates rather than refusing, so this is
           the same number said earlier — a box that stops accepting text is
           clearer than one that quietly loses the end of it. */
        maxLength={96}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            save();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </div>
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

  /*
   * `worn` is the look the picture was rendered from, or null when this is a
   * photograph somebody picked.
   *
   * Both paths upload a PNG — the editor renders one so a client too old to
   * know about the string still shows the right owl, and so the server has
   * something to take a dominant colour from. So the upload on its own cannot
   * say which of the two happened. Null is not "leave it alone": it is what
   * clears a designed look when somebody goes back to a photograph.
   */
  /**
   * Whether this server lets us put a picture on it.
   *
   * Applied per host because a profile change goes to several at once and they
   * will not agree: an older server has never heard of `upload_avatar_image`,
   * and a server that has simply not granted it is a no. Both look like an
   * absence in the list, so the catalogue is what separates them.
   */
  const mayUploadPicture = (host: string): boolean => {
    const info = serverDetailsList[host]?.server_info;
    const catalogue = info?.permission_catalogue;
    if (Array.isArray(catalogue) && !catalogue.includes("upload_avatar_image")) return true;
    if (!Array.isArray(info?.permissions)) return true;
    return info.permissions.includes("upload_avatar_image");
  };

  const processAndUpload = async (file: File, hosts: string[], worn: string | null) => {
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

    /*
     * An owl does not need the upload to have happened.
     *
     * It is a string on the profile and every client draws it, so on a server
     * that does not allow pictures the owl still arrives — only the PNG that
     * usually accompanies it is skipped. That is what makes
     * `upload_avatar_image` a restriction on files rather than on having an
     * avatar at all.
     *
     * A picture has nothing to fall back on, so those hosts are reported.
     */
    const permitted = hosts.filter(mayUploadPicture);
    const refused = hosts.filter((h) => !permitted.includes(h));

    if (refused.length > 0) {
      if (worn) {
        refused.forEach((host) => {
          sockets[host]?.emit("profile:update", { avatarWorn: worn });
          sockets[host]?.emit("members:fetch");
          setServerProfiles((prev) => ({
            ...prev,
            [host]: { ...prev[host], avatarWorn: worn },
          }));
        });
      } else if (permitted.length === 0) {
        toast.error(
          hosts.length === 1
            ? "This server does not let you upload a picture. Designing an owl still works."
            : "None of these servers let you upload a picture. Designing an owl still works.",
        );
        return;
      }
    }

    hosts = permitted;

    setUploading(true);
    try {
      if (hosts.length === 0) {
        await setAvatarFile(uploadFile);
        setStoredWorn(worn);
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
              avatarWorn: worn,
            },
          }));
        }
        // Sent whether or not the upload returned a file id, and sent as an
        // explicit null for a photograph. A member who had a designed owl and
        // has just picked a picture needs the old string cleared; leaving it
        // would keep drawing the owl over the picture they chose.
        sockets[host]?.emit("profile:update", { avatarWorn: worn });
        sockets[host]?.emit("avatar:updated");
        sockets[host]?.emit("members:fetch");
      });

      if (anySuccess) {
        await setAvatarFile(uploadFile);
        setStoredWorn(worn);
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
            avatarWorn: null,
          },
        }));
        // Removing an avatar means going back to the owl the nickname draws.
        // A designed look left behind would survive the removal and keep being
        // drawn, which is not what "remove" says.
        sockets[host]?.emit("profile:update", { avatarWorn: null });
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
    // A picture somebody picked, so any designed look is being replaced.
    await processAndUpload(file, hosts, null);
    e.target.value = "";
  };

  const triggerFilePick = (host: string | null) => {
    pendingActionRef.current = { type: "pick", host };
    fileInputRef.current?.click();
  };

  /*
   * Clicking the avatar used to open a file picker. It asks first now, because
   * a picture is no longer the only kind of avatar there is.
   *
   * The host is remembered across both dialogs: this screen edits either the
   * account's avatar or one server's, and which one is decided by whichever
   * avatar was clicked.
   */
  const [choosingFor, setChoosingFor] = useState<string | null | undefined>(undefined);
  const [designingFor, setDesigningFor] = useState<string | null | undefined>(undefined);

  const handleUseOwl = async (png: Blob, worn: string, host: string | null) => {
    setDesigningFor(undefined);
    setChoosingFor(undefined);
    const file = new File([png], "avatar.png", { type: "image/png" });
    await processAndUpload(file, host ? [host] : serverHosts, worn);
  };

  /**
   * Take one server's avatar and use it everywhere — the other direction from
   * the button next door.
   *
   * Owls and pictures are the same job here, which is worth saying because it
   * looks like it should be two. A designed owl is stored as an uploaded PNG
   * plus the string that draws it, so both cases are "fetch the bytes this
   * server already has, and carry the worn string with them". Re-rendering the
   * owl would be a second implementation of something that is already a file.
   *
   * The nickname is deliberately left alone. It is per-server for a reason, and
   * quietly renaming somebody on five servers is not what this asked for.
   */
  const handleSyncFromServer = async (sourceHost: string) => {
    if (syncing || uploading || removing) return;
    if (connectedHosts.length === 0) return;

    const profile = serverProfiles[sourceHost];
    const worn = profile?.avatarWorn ?? null;
    const source = profile?.avatarUrl;

    if (!source) {
      toast.error("Nothing to copy: this server has no avatar of its own yet.");
      return;
    }

    setSyncing(true);
    try {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`the server answered ${response.status}`);
      }

      const file = await asUploadableAvatar(await response.blob());

      // Including the server it came from. Re-uploading there is a few hundred
      // milliseconds and it keeps one path rather than two, which is worth
      // more than the round trip — and it settles the case where that server's
      // copy is the one that is out of date with its own worn string.
      await processAndUpload(file, connectedHosts, worn);
    } catch (error) {
      toast.error(
        `Could not copy that avatar: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncToAll = async () => {
    if (syncing || connectedHosts.length === 0) return;
    setSyncing(true);

    try {
      const hosts = connectedHosts;

      // The look goes with the nickname and the picture, because "sync to all"
      // means this profile everywhere. Sent even when it is null — a server
      // still holding a look this account has since dropped is exactly the
      // disagreement the button exists to settle.
      const worn = getStoredWorn();
      hosts.forEach(host => {
        sockets[host]?.emit("profile:update", { nickname, avatarWorn: worn });
        setServerProfiles(prev => ({
          ...prev,
          [host]: { ...prev[host], nickname, avatarWorn: worn },
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

  // Re-read rather than held in state, because every path that changes it
  // already re-renders this screen: saving a design, uploading a picture and
  // removing one all set `uploading` or `removing` on the way through.
  const storedWorn = getStoredWorn();

  // One list, rendered two ways. Built here rather than inline so the tabs and
  // the select cannot drift apart on what a server is called.
  const serverTabs = [
    { label: "All Servers", value: "all" },
    ...serverHosts.map((host) => ({
      label:
        serverDetailsList?.[host]?.server_info?.name ||
        servers[host]?.name ||
        host,
      value: host,
    })),
  ];

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        Profile
      </h2>

      <ActivityField />

      {serverHosts.length > 0 && (
        <div className="flex justify-center" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {/* The tab row does not wrap or scroll, so past a handful of servers
              the names on the end run off the edge of the panel and cannot be
              reached at all. A select holds any number of them in the width of
              one control, so the tabs stay for the case they suit and hand over
              once they stop fitting. */}
          {serverHosts.length >= SERVERS_BEFORE_DROPDOWN ? (
            <Select
              value={selectedTab}
              onValueChange={(v) => setSelectedTab(String(v))}
              placeholder="Which server"
              options={serverTabs}
            />
          ) : (
            <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(String(v))}>
              <Tabs.List aria-label="Which server">
                {serverTabs.map((tab) => (
                  <Tabs.Tab key={tab.value} value={tab.value}>
                    {tab.label}
                  </Tabs.Tab>
                ))}
                <Tabs.Indicator />
              </Tabs.List>
            </Tabs>
          )}
        </div>
      )}

      {selectedTab === "all" ? (
        <>
          <ProfileEditor
            nickname={nickname}
            avatarUrl={allServerAvatarUrl}
            generatedAvatarUrl={resolveAvatarSrc(undefined, nickname)}
            worn={storedWorn}
            initial={initial}
            uploading={uploading}
            removing={removing}
            onSaveNickname={(name) => handleSaveNickname(name, serverHosts)}
            onPickAvatar={() => setChoosingFor(null)}
            onRemoveAvatar={() => handleRemoveAvatar(serverHosts)}
            serverLabel={serverHosts.length > 0 ? "Changes apply to all servers" : undefined}
          />
          {connectedHosts.length > 0 && (
            <div className="flex justify-center" style={{ paddingTop: 4 }}>
              <Button size="small"
                disabled={syncing || uploading || removing}
                onClick={handleSyncToAll}
              >
                <PiArrowsClockwiseFill size={16} style={syncing ? { animation: "spin 1s linear infinite" } : undefined} />
                {syncing ? "Syncing..." : "Sync to all servers"}
              </Button>
            </div>
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

          /* Offered only when there is somewhere for it to go and something
             to send. `avatarUrl` is null on a server you have never given an
             avatar of its own, and the button would copy the account default
             onto itself. */
          const canCopyOutward =
            connectedHosts.length > 1 && Boolean(profile?.avatarUrl);

          return (
            <>
              <ProfileEditor
                nickname={serverNickname}
                avatarUrl={serverAvatarUrl}
                generatedAvatarUrl={resolveAvatarSrc(undefined, serverNickname)}
                worn={profile?.avatarWorn ?? storedWorn}
                initial={serverInitial}
                uploading={uploading}
                removing={removing}
                onSaveNickname={(name) => handleSaveNickname(name, [host])}
                onPickAvatar={() => setChoosingFor(host)}
                onRemoveAvatar={() => handleRemoveAvatar([host])}
                serverLabel={serverName}
                scopedToServer={serverName}
              />
              {canCopyOutward && (
                <div className="flex flex-col items-center gap-1" style={{ paddingTop: 4 }}>
                  <Button
                    size="small"
                    disabled={syncing || uploading || removing}
                    onClick={() => void handleSyncFromServer(host)}
                  >
                    <PiArrowsClockwiseFill
                      size={16}
                      style={syncing ? { animation: "spin 1s linear infinite" } : undefined}
                    />
                    {syncing ? "Copying..." : "Use this avatar everywhere"}
                  </Button>
                  <span className="text-xs text-gryt-muted">
                    Your name on each server stays as it is.
                  </span>
                </div>
              )}
            </>
          );
        })()
      )}

      {userId && (
        <div className="flex items-center justify-center gap-1" style={{ marginTop: "auto", paddingTop: 16 }}>
          <span className="text-xs" style={{ fontFamily: "var(--code-font-family)", userSelect: "all" }}>
            {userId}
          </span>
          <Tooltip title={copied ? "Copied!" : "Copy User ID"}>
            <IconButton tone="ghost" size="xsmall"
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
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      <AvatarChoiceDialog
        nickname={nickname}
        onDesign={() => setDesigningFor(choosingFor)}
        onOpenChange={(next) => {
          if (!next) setChoosingFor(undefined);
        }}
        /* Said rather than hidden. Hiding it would need a prop on
           `AvatarChoiceDialog` and a @gryt/ui release, and "the option is gone"
           reads as a broken build where "you cannot do this here, and here is
           what still works" reads as a rule. */
        onUpload={() => {
          const target = choosingFor ?? null;
          const hosts = target ? [target] : serverHosts;
          if (hosts.length > 0 && !hosts.some(mayUploadPicture)) {
            toast.error(
              hosts.length === 1
                ? "This server does not let you upload a picture. Designing an owl still works."
                : "None of your servers let you upload a picture. Designing an owl still works.",
            );
            return;
          }
          triggerFilePick(target);
        }}
        open={choosingFor !== undefined}
      />

      <OwlDesignerDialog
        nickname={nickname}
        onOpenChange={(next) => {
          if (!next) setDesigningFor(undefined);
        }}
        onSave={(png, worn) => void handleUseOwl(png, worn, designingFor ?? null)}
        open={designingFor !== undefined}
        saving={uploading}
      />
    </SettingsContainer>
  );
}
