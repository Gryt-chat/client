import {
  AlertDialog,
  Button,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { unzipSync } from "fflate";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MdCheck, MdClose, MdDelete, MdEdit, MdFileUpload } from "react-icons/md";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import {
  fetchCustomEmojis,
  getCustomEmojiUrl,
  setCustomEmojis,
} from "../utils/emojiData";
import { BttvImport } from "./BttvImport";

const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;
const IMAGE_MIME_RE = /^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);

type EmojiItem = { name: string; file_id: string };

interface PendingEmoji {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  nameError: string | null;
  nameWarning: string | null;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
}

function deriveEmojiName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/^\d+[-_]/, "");
  const sanitized = base.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const trimmed = sanitized.replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
  if (trimmed.length < 2) return trimmed.padEnd(2, "_");
  return trimmed.slice(0, 32);
}

function extToMime(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === "jpg" || lower === "jpeg") return "image/jpeg";
  if (lower === "png") return "image/png";
  if (lower === "webp") return "image/webp";
  if (lower === "gif") return "image/gif";
  if (lower === "svg") return "image/svg+xml";
  if (lower === "avif") return "image/avif";
  return "application/octet-stream";
}

function isZipFile(file: File): boolean {
  return ZIP_TYPES.has(file.type) || file.name.toLowerCase().endsWith(".zip");
}

async function extractImagesFromZip(zipFile: File): Promise<File[]> {
  const buf = await zipFile.arrayBuffer();
  const entries = unzipSync(new Uint8Array(buf));
  const images: File[] = [];

  for (const [path, data] of Object.entries(entries)) {
    if (path.startsWith("__MACOSX/") || path.endsWith("/")) continue;
    const filename = path.split("/").pop() || path;
    if (!IMAGE_EXT_RE.test(filename)) continue;
    if (data.length === 0 || data.length > 5 * 1024 * 1024) continue;
    const ext = filename.split(".").pop() || "png";
    const mime = extToMime(ext);
    const copied = new Uint8Array(data) as BlobPart;
    images.push(new File([copied], filename, { type: mime }));
  }

  return images;
}

function deduplicateNames(names: string[], existingNames: Set<string>): string[] {
  const result: string[] = [];
  const taken = new Set(existingNames);

  for (const name of names) {
    if (!taken.has(name)) {
      result.push(name);
      taken.add(name);
    } else {
      let suffix = 2;
      let candidate = `${name}_${suffix}`.slice(0, 32);
      while (taken.has(candidate)) {
        suffix++;
        candidate = `${name}_${suffix}`.slice(0, 32);
      }
      result.push(candidate);
      taken.add(candidate);
    }
  }
  return result;
}

function validateName(
  name: string,
  existingNames: Set<string>,
  batchNames: string[],
  selfIndex: number,
): { error: string | null; warning: string | null } {
  if (!name) return { error: "Name is required.", warning: null };
  if (!EMOJI_NAME_RE.test(name)) return { error: "2-32 lowercase letters, numbers, or underscores.", warning: null };
  for (let i = 0; i < batchNames.length; i++) {
    if (i !== selfIndex && batchNames[i] === name) return { error: "Duplicate name in batch.", warning: null };
  }
  if (existingNames.has(name)) return { error: null, warning: "Already exists — will replace." };
  return { error: null, warning: null };
}

export function ServerEmojisTab({
  host,
  accessToken,
}: {
  host: string;
  accessToken: string | null;
}) {
  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [pendingEmojis, setPendingEmojis] = useState<PendingEmoji[]>([]);
  const [editingEmoji, setEditingEmoji] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveAccessToken = useMemo(
    () => accessToken || getServerAccessToken(host),
    [accessToken, host],
  );

  const base = useMemo(() => getServerHttpBase(host), [host]);

  const existingNames = useMemo(() => new Set(emojis.map((e) => e.name)), [emojis]);

  const refresh = useCallback(async () => {
    console.log("[EmojiUpload] refresh: fetching emojis for host:", host);
    setLoading(true);
    try {
      const list = await fetchCustomEmojis(host);
      console.log("[EmojiUpload] refresh: got", list.length, "emojis");
      setEmojis(list);
      setCustomEmojis(list, host);
    } catch (err) {
      console.error("[EmojiUpload] refresh: failed to fetch emojis:", err);
      toast.error("Failed to fetch emojis.");
    } finally {
      setLoading(false);
    }
  }, [host]);

  useEffect(() => {
    if (host) refresh();
  }, [host, refresh]);

  useEffect(() => {
    return () => {
      pendingEmojis.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addImageFiles = useCallback((validFiles: File[]) => {
    console.log("[EmojiUpload] addImageFiles:", validFiles.length, "file(s)", validFiles.map(f => ({ name: f.name, type: f.type, size: f.size })));
    if (validFiles.length === 0) { console.log("[EmojiUpload] addImageFiles: empty array, bailing"); return; }

    const rawNames = validFiles.map((f) => deriveEmojiName(f.name));

    setPendingEmojis((prev) => {
      const prevNames = new Set(prev.map((p) => p.name));
      const allExisting = new Set([...existingNames, ...prevNames]);
      const uniqueNames = deduplicateNames(rawNames, allExisting);
      const allBatchNames = [...prev.map((p) => p.name), ...uniqueNames];

      const newItems: PendingEmoji[] = validFiles.map((file, i) => {
        const name = uniqueNames[i];
        const selfIndex = prev.length + i;
        const { error, warning } = validateName(name, existingNames, allBatchNames, selfIndex);
        return {
          id: `emoji-${Date.now()}-${Math.random().toString(36).slice(2)}-${i}`,
          file,
          previewUrl: URL.createObjectURL(file),
          name,
          nameError: error,
          nameWarning: warning,
          status: "pending",
          progress: 0,
        };
      });
      return [...prev, ...newItems];
    });
  }, [existingNames]);

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const liveFiles = e.target.files;
    console.log("[EmojiUpload] handleFileSelect fired — files:", liveFiles?.length ?? 0);
    if (!liveFiles || liveFiles.length === 0) { console.log("[EmojiUpload] handleFileSelect: no files selected, bailing"); return; }
    const files = Array.from(liveFiles);
    e.currentTarget.value = "";

    console.log("[EmojiUpload] handleFileSelect: snapshot", files.map(f => ({ name: f.name, type: f.type, size: f.size })));

    const imageFiles: File[] = [];
    const zipFiles: File[] = [];

    for (const f of files) {
      const isImage = IMAGE_MIME_RE.test(f.type) || IMAGE_EXT_RE.test(f.name);
      const isZip = isZipFile(f);
      console.log("[EmojiUpload] handleFileSelect: file:", f.name, "type:", f.type, "size:", f.size, "isImage:", isImage, "isZip:", isZip);
      if (isZip) {
        zipFiles.push(f);
      } else if (isImage) {
        if (f.size > 5 * 1024 * 1024) {
          toast.error(`"${f.name}": too large (max 5 MB).`);
          continue;
        }
        imageFiles.push(f);
      } else {
        console.warn("[EmojiUpload] handleFileSelect: rejected file:", f.name, "type:", f.type);
        toast.error(`"${f.name}": unsupported format. Use PNG, JPEG, WebP, GIF, AVIF, SVG, or ZIP.`);
      }
    }

    for (const zip of zipFiles) {
      try {
        const extracted = await extractImagesFromZip(zip);
        if (extracted.length === 0) {
          toast.error(`"${zip.name}": no valid images found in archive.`);
        } else {
          toast.success(`Extracted ${extracted.length} image(s) from "${zip.name}".`);
          imageFiles.push(...extracted);
        }
      } catch (err) {
        console.error("[EmojiUpload] handleFileSelect: zip extraction failed:", zip.name, err);
        toast.error(`"${zip.name}": failed to read archive.`);
      }
    }

    console.log("[EmojiUpload] handleFileSelect: passing", imageFiles.length, "image(s) to addImageFiles");
    addImageFiles(imageFiles);
  };

  const updatePendingName = (id: string, newName: string) => {
    const sanitized = newName.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setPendingEmojis((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const updated = prev.map((p, i) => {
        if (i === idx) {
          const batchNames = prev.map((pp, j) => (j === idx ? sanitized : pp.name));
          const { error, warning } = validateName(sanitized, existingNames, batchNames, idx);
          return { ...p, name: sanitized, nameError: error, nameWarning: warning };
        }
        return p;
      });
      const batchNames = updated.map((p) => p.name);
      return updated.map((p, i) => {
        if (p.status === "done") return { ...p, nameError: null, nameWarning: null };
        const { error, warning } = validateName(p.name, existingNames, batchNames, i);
        return { ...p, nameError: error, nameWarning: warning };
      });
    });
  };

  const removePending = (id: string) => {
    setPendingEmojis((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      const remaining = prev.filter((p) => p.id !== id);
      const batchNames = remaining.map((p) => p.name);
      return remaining.map((p, i) => {
        if (p.status === "done") return { ...p, nameError: null, nameWarning: null };
        const { error, warning } = validateName(p.name, existingNames, batchNames, i);
        return { ...p, nameError: error, nameWarning: warning };
      });
    });
  };

  const uploadOne = (item: PendingEmoji): Promise<boolean> => {
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return Promise.resolve(false);
    }

    setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading", progress: 0 } : p)));

    return new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p)));
        }
      });

      xhr.addEventListener("load", () => {
        let data: Record<string, unknown> = {};
        try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          toast.success(`Emoji :${item.name}: uploaded!`);
          setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "done", progress: 100 } : p)));
          resolve(true);
        } else {
          const errMsg = (typeof data?.message === "string" && data.message) ||
            (typeof data?.error === "string" && data.error) ||
            `HTTP ${xhr.status}`;
          toast.error(`:${item.name}: — ${errMsg}`);
          setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "error", progress: 0 } : p)));
          resolve(false);
        }
      });

      xhr.addEventListener("error", () => {
        toast.error(`:${item.name}: — Upload failed.`);
        setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "error", progress: 0 } : p)));
        resolve(false);
      });

      const form = new FormData();
      form.append("file", item.file);
      form.append("name", item.name);

      xhr.open("POST", `${base}/api/emojis`);
      xhr.setRequestHeader("Authorization", `Bearer ${effectiveAccessToken}`);
      xhr.send(form);
    });
  };

  const handleUploadAll = async () => {
    const toUpload = pendingEmojis.filter((p) => p.status === "pending" && !p.nameError);
    if (toUpload.length === 0) return;
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return;
    }

    setUploading(true);
    let successCount = 0;

    for (const item of toUpload) {
      const ok = await uploadOne(item);
      if (ok) successCount++;
    }

    if (successCount > 0) await refresh();

    setPendingEmojis((prev) => {
      const remaining = prev
        .filter((p) => p.status !== "done")
        .map((p) => (p.status === "error" ? { ...p, status: "pending" as const, progress: 0 } : p));
      const batchNames = remaining.map((p) => p.name);
      return remaining.map((p, i) => {
        const { error, warning } = validateName(p.name, existingNames, batchNames, i);
        return { ...p, nameError: error, nameWarning: warning };
      });
    });
    setUploading(false);
  };

  const handleUploadSingle = async (id: string) => {
    const item = pendingEmojis.find((p) => p.id === id);
    console.log("[EmojiUpload] handleUploadSingle:", { id, found: !!item, nameError: item?.nameError, status: item?.status, hasToken: !!effectiveAccessToken });
    if (!item || item.nameError) return;

    setUploading(true);
    const ok = await uploadOne(item);
    if (ok) {
      await refresh();
      setPendingEmojis((prev) => {
        const remaining = prev.filter((p) => p.status !== "done");
        const batchNames = remaining.map((p) => p.name);
        return remaining.map((p, i) => {
          const { error, warning } = validateName(p.name, existingNames, batchNames, i);
          return { ...p, nameError: error, nameWarning: warning };
        });
      });
    }
    setUploading(false);
  };

  const handleDelete = async (emojiName: string) => {
    if (!effectiveAccessToken) {
      toast.error("Not authenticated.");
      return;
    }

    setDeletingName(emojiName);
    try {
      const resp = await fetch(`${base}/api/emojis/${encodeURIComponent(emojiName)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${effectiveAccessToken}` },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `HTTP ${resp.status}`,
        );
      }

      toast.success(`Emoji :${emojiName}: deleted.`);
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete emoji.");
    } finally {
      setDeletingName(null);
    }
  };

  const [deletingAll, setDeletingAll] = useState(false);

  const handleDeleteAll = async () => {
    if (!effectiveAccessToken) {
      toast.error("Not authenticated.");
      return;
    }

    setDeletingAll(true);
    try {
      const resp = await fetch(`${base}/api/emojis/all`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${effectiveAccessToken}` },
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `HTTP ${resp.status}`,
        );
      }

      toast.success(`Deleted ${data.deleted ?? "all"} emoji(s).`);
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete emojis.");
    } finally {
      setDeletingAll(false);
    }
  };

  const startEditing = (emojiName: string) => {
    setEditingEmoji(emojiName);
    setEditingName(emojiName);
    setEditingError(null);
  };

  const cancelEditing = () => {
    setEditingEmoji(null);
    setEditingName("");
    setEditingError(null);
  };

  const handleRename = async () => {
    if (!editingEmoji || !effectiveAccessToken) return;
    const newName = editingName.trim().toLowerCase();
    if (newName === editingEmoji) { cancelEditing(); return; }
    if (!EMOJI_NAME_RE.test(newName)) {
      setEditingError("2-32 lowercase letters, numbers, or underscores.");
      return;
    }
    if (existingNames.has(newName)) {
      setEditingError(`":${newName}:" already exists.`);
      return;
    }

    setRenaming(true);
    try {
      const resp = await fetch(`${base}/api/emojis/${encodeURIComponent(editingEmoji)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${effectiveAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `HTTP ${resp.status}`,
        );
      }
      toast.success(`Renamed :${editingEmoji}: to :${newName}:`);
      cancelEditing();
      await refresh();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Rename failed.";
      setEditingError(msg);
    } finally {
      setRenaming(false);
    }
  };

  const uploadableCount = pendingEmojis.filter((p) => p.status === "pending" && !p.nameError).length;

  return (
    <Flex direction="column" gap="4">
      <Text size="2" color="gray">
        Upload custom emojis for this server. Members can use them with{" "}
        <code>:name:</code> syntax.
      </Text>

      {/* Upload form */}
      <Flex
        direction="column"
        gap="3"
        p="3"
        style={{
          border: "1px solid var(--gray-a5)",
          borderRadius: "var(--radius-2)",
        }}
      >
        <Flex justify="between" align="center">
          <Text size="2" weight="medium">
            Upload new emojis
          </Text>
          <Button
            variant="soft"
            size="1"
            onClick={() => {
              console.log("[EmojiUpload] 'Choose files' clicked — fileInputRef.current:", !!fileInputRef.current, "uploading:", uploading);
              fileInputRef.current?.click();
            }}
            disabled={uploading}
          >
            Choose files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,.svg,.avif,.zip,application/zip"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
        </Flex>

        {pendingEmojis.length > 0 && (
          <Flex direction="column" gap="2" style={{ maxHeight: 300, overflowY: "auto" }}>
            {pendingEmojis.map((p) => (
              <Flex
                key={p.id}
                align="center"
                gap="2"
                py="1"
                px="2"
                style={{
                  border: "1px solid var(--gray-a4)",
                  borderRadius: "var(--radius-1)",
                  opacity: p.status === "uploading" ? 0.6 : 1,
                }}
              >
                <img
                  src={p.previewUrl}
                  alt="preview"
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: "contain",
                    borderRadius: "var(--radius-1)",
                    flexShrink: 0,
                  }}
                />
                <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
                  <TextField.Root
                    size="1"
                    value={p.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => updatePendingName(p.id, e.target.value)}
                    placeholder="shortcode"
                    disabled={uploading || p.status === "uploading"}
                  />
                  {p.nameError && (
                    <Text size="1" color="red" style={{ lineHeight: 1.2 }}>
                      {p.nameError}
                    </Text>
                  )}
                  {!p.nameError && p.nameWarning && (
                    <Text size="1" color="yellow" style={{ lineHeight: 1.2 }}>
                      {p.nameWarning}
                    </Text>
                  )}
                  {p.status === "uploading" && (
                    <div style={{
                      width: "100%",
                      height: 4,
                      borderRadius: 2,
                      background: "var(--gray-a4)",
                      overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${p.progress}%`,
                        height: "100%",
                        borderRadius: 2,
                        background: "var(--accent-9)",
                        transition: "width 150ms ease",
                      }} />
                    </div>
                  )}
                </Flex>
                {p.status === "uploading" && (
                  <Text size="1" color="gray" style={{ flexShrink: 0, minWidth: 32, textAlign: "right" }}>
                    {p.progress}%
                  </Text>
                )}
                {p.status === "error" && (
                  <Text size="1" color="red" style={{ flexShrink: 0 }}>
                    Failed
                  </Text>
                )}
                <IconButton
                  variant="ghost"
                  size="1"
                  title="Upload this emoji"
                  disabled={uploading || !!p.nameError || p.status === "uploading"}
                  onClick={() => handleUploadSingle(p.id)}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                >
                  <MdFileUpload size={14} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  color="red"
                  size="1"
                  title="Remove"
                  disabled={uploading}
                  onClick={() => removePending(p.id)}
                  style={{ cursor: "pointer", flexShrink: 0 }}
                >
                  <MdClose size={14} />
                </IconButton>
              </Flex>
            ))}
          </Flex>
        )}

        {pendingEmojis.length > 0 && (
          <Flex justify="end" gap="2">
            <Button
              variant="soft"
              color="gray"
              size="1"
              disabled={uploading}
              onClick={() => {
                pendingEmojis.forEach((p) => URL.revokeObjectURL(p.previewUrl));
                setPendingEmojis([]);
              }}
            >
              Clear all
            </Button>
            <Button
              size="1"
              disabled={uploading || uploadableCount === 0}
              onClick={handleUploadAll}
            >
              {uploading ? "Uploading..." : `Upload all (${uploadableCount})`}
            </Button>
          </Flex>
        )}
      </Flex>

      {/* BetterTTV import */}
      <BttvImport
        host={host}
        accessToken={effectiveAccessToken}
        existingNames={existingNames}
        onImportComplete={refresh}
      />

      {/* Emoji list */}
      <Flex direction="column" gap="2">
        <Flex justify="between" align="center">
          <Text size="2" weight="medium">
            Custom emojis {!loading && `(${emojis.length})`}
          </Text>
          {emojis.length > 0 && (
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button variant="soft" color="red" size="1" disabled={deletingAll}>
                  <MdDelete size={14} />
                  {deletingAll ? "Deleting..." : "Delete all"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>Delete all emojis?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  This will permanently delete all {emojis.length} custom emoji{emojis.length !== 1 ? "s" : ""} from this server. This cannot be undone.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">Cancel</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button variant="solid" color="red" onClick={handleDeleteAll}>
                      Delete all
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          )}
        </Flex>

        {loading ? (
          <Text size="2" color="gray">
            Loading...
          </Text>
        ) : emojis.length === 0 ? (
          <Text size="2" color="gray">
            No custom emojis yet.
          </Text>
        ) : (
          <Flex direction="column" gap="1">
            {emojis.map((e) => (
              <Flex
                key={e.name}
                align="center"
                gap="3"
                py="1"
                px="2"
                style={{
                  borderRadius: "var(--radius-1)",
                  transition: "background 120ms",
                }}
                className="emoji-row"
              >
                <img
                  src={getCustomEmojiUrl(host, e.name)}
                  alt={`:${e.name}:`}
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: "contain",
                  }}
                />
                {editingEmoji === e.name ? (
                  <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
                    <Flex align="center" gap="1">
                      <TextField.Root
                        size="1"
                        value={editingName}
                        onChange={(ev: ChangeEvent<HTMLInputElement>) => {
                          const v = ev.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                          setEditingName(v);
                          setEditingError(null);
                        }}
                        onKeyDown={(ev: React.KeyboardEvent) => {
                          if (ev.key === "Enter") handleRename();
                          if (ev.key === "Escape") cancelEditing();
                        }}
                        disabled={renaming}
                        autoFocus
                        style={{ flex: 1 }}
                      />
                      <IconButton
                        variant="ghost"
                        size="1"
                        title="Save"
                        disabled={renaming}
                        onClick={handleRename}
                        style={{ cursor: "pointer", flexShrink: 0 }}
                      >
                        <MdCheck size={14} />
                      </IconButton>
                      <IconButton
                        variant="ghost"
                        size="1"
                        title="Cancel"
                        disabled={renaming}
                        onClick={cancelEditing}
                        style={{ cursor: "pointer", flexShrink: 0 }}
                      >
                        <MdClose size={14} />
                      </IconButton>
                    </Flex>
                    {editingError && (
                      <Text size="1" color="red" style={{ lineHeight: 1.2 }}>
                        {editingError}
                      </Text>
                    )}
                  </Flex>
                ) : (
                  <Text size="2" style={{ flex: 1 }}>
                    <code>:{e.name}:</code>
                  </Text>
                )}
                {editingEmoji !== e.name && (
                  <>
                    <IconButton
                      variant="ghost"
                      size="1"
                      onClick={() => startEditing(e.name)}
                      title={`Rename :${e.name}:`}
                      style={{ cursor: "pointer" }}
                    >
                      <MdEdit size={14} />
                    </IconButton>
                    <IconButton
                      variant="ghost"
                      color="red"
                      size="1"
                      onClick={() => handleDelete(e.name)}
                      disabled={deletingName === e.name}
                      title={`Delete :${e.name}:`}
                      style={{ cursor: "pointer" }}
                    >
                      <MdDelete size={14} />
                    </IconButton>
                  </>
                )}
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
