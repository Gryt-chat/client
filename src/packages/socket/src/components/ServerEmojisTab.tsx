import { Cross1Icon, TrashIcon, UploadIcon } from "@radix-ui/react-icons";
import {
  Button,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { unzipSync } from "fflate";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import {
  fetchCustomEmojis,
  getCustomEmojiUrl,
  setCustomEmojis,
} from "../utils/emojiData";

const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;
const IMAGE_MIME_RE = /^image\/(png|jpeg|webp|gif)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);

type EmojiItem = { name: string; file_id: string };

interface PendingEmoji {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  nameError: string | null;
  status: "pending" | "uploading" | "done" | "error";
}

function deriveEmojiName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
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

function validateName(name: string, existingNames: Set<string>, batchNames: string[], selfIndex: number): string | null {
  if (!name) return "Name is required.";
  if (!EMOJI_NAME_RE.test(name)) return "2-32 lowercase letters, numbers, or underscores.";
  if (existingNames.has(name)) return `":${name}:" already exists on the server.`;
  for (let i = 0; i < batchNames.length; i++) {
    if (i !== selfIndex && batchNames[i] === name) return "Duplicate name in batch.";
  }
  return null;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveAccessToken = useMemo(
    () => accessToken || getServerAccessToken(host),
    [accessToken, host],
  );

  const base = useMemo(() => getServerHttpBase(host), [host]);

  const existingNames = useMemo(() => new Set(emojis.map((e) => e.name)), [emojis]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchCustomEmojis(host);
      setEmojis(list);
      setCustomEmojis(list, host);
    } catch {
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
    if (validFiles.length === 0) return;

    const rawNames = validFiles.map((f) => deriveEmojiName(f.name));

    setPendingEmojis((prev) => {
      const prevNames = new Set(prev.map((p) => p.name));
      const allExisting = new Set([...existingNames, ...prevNames]);
      const uniqueNames = deduplicateNames(rawNames, allExisting);
      const allBatchNames = [...prev.map((p) => p.name), ...uniqueNames];

      const newItems: PendingEmoji[] = validFiles.map((file, i) => {
        const name = uniqueNames[i];
        const selfIndex = prev.length + i;
        return {
          id: `emoji-${Date.now()}-${Math.random().toString(36).slice(2)}-${i}`,
          file,
          previewUrl: URL.createObjectURL(file),
          name,
          nameError: validateName(name, existingNames, allBatchNames, selfIndex),
          status: "pending",
        };
      });
      return [...prev, ...newItems];
    });
  }, [existingNames]);

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    e.currentTarget.value = "";

    const imageFiles: File[] = [];
    const zipFiles: File[] = [];

    for (const f of files) {
      if (isZipFile(f)) {
        zipFiles.push(f);
      } else if (IMAGE_MIME_RE.test(f.type)) {
        if (f.size > 5 * 1024 * 1024) {
          toast.error(`"${f.name}": too large (max 5 MB).`);
          continue;
        }
        imageFiles.push(f);
      } else {
        toast.error(`"${f.name}": unsupported format. Use PNG, JPEG, WebP, GIF, or ZIP.`);
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
      } catch {
        toast.error(`"${zip.name}": failed to read archive.`);
      }
    }

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
          return { ...p, name: sanitized, nameError: validateName(sanitized, existingNames, batchNames, idx) };
        }
        return p;
      });
      const batchNames = updated.map((p) => p.name);
      return updated.map((p, i) => ({
        ...p,
        nameError: p.status === "done" ? null : validateName(p.name, existingNames, batchNames, i),
      }));
    });
  };

  const removePending = (id: string) => {
    setPendingEmojis((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      const remaining = prev.filter((p) => p.id !== id);
      const batchNames = remaining.map((p) => p.name);
      return remaining.map((p, i) => ({
        ...p,
        nameError: p.status === "done" ? null : validateName(p.name, existingNames, batchNames, i),
      }));
    });
  };

  const uploadOne = async (item: PendingEmoji): Promise<boolean> => {
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return false;
    }

    setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading" } : p)));

    try {
      const form = new FormData();
      form.append("file", item.file);
      form.append("name", item.name);

      const resp = await fetch(`${base}/api/emojis`, {
        method: "POST",
        headers: { Authorization: `Bearer ${effectiveAccessToken}` },
        body: form,
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
          (typeof data?.error === "string" && data.error) ||
          `HTTP ${resp.status}`,
        );
      }

      toast.success(`Emoji :${item.name}: uploaded!`);
      setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "done" } : p)));
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed.";
      toast.error(`:${item.name}: — ${msg}`);
      setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "error" } : p)));
      return false;
    }
  };

  const handleUploadAll = async () => {
    const toUpload = pendingEmojis.filter((p) => p.status === "pending" && !p.nameError);
    if (toUpload.length === 0) return;

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
        .map((p) => (p.status === "error" ? { ...p, status: "pending" as const } : p));
      const batchNames = remaining.map((p) => p.name);
      return remaining.map((p, i) => ({
        ...p,
        nameError: validateName(p.name, existingNames, batchNames, i),
      }));
    });
    setUploading(false);
  };

  const handleUploadSingle = async (id: string) => {
    const item = pendingEmojis.find((p) => p.id === id);
    if (!item || item.nameError) return;

    setUploading(true);
    const ok = await uploadOne(item);
    if (ok) {
      await refresh();
      setPendingEmojis((prev) => {
        const remaining = prev.filter((p) => p.status !== "done");
        const batchNames = remaining.map((p) => p.name);
        return remaining.map((p, i) => ({
          ...p,
          nameError: validateName(p.name, existingNames, batchNames, i),
        }));
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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            Choose files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,.zip,application/zip"
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
                </Flex>
                {p.status === "uploading" && (
                  <Text size="1" color="gray" style={{ flexShrink: 0 }}>
                    Uploading...
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
                  <UploadIcon width={14} height={14} />
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
                  <Cross1Icon width={14} height={14} />
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

      {/* Emoji list */}
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">
          Custom emojis {!loading && `(${emojis.length})`}
        </Text>

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
                <Text size="2" style={{ flex: 1 }}>
                  <code>:{e.name}:</code>
                </Text>
                <IconButton
                  variant="ghost"
                  color="red"
                  size="1"
                  onClick={() => handleDelete(e.name)}
                  disabled={deletingName === e.name}
                  title={`Delete :${e.name}:`}
                  style={{ cursor: "pointer" }}
                >
                  <TrashIcon width={14} height={14} />
                </IconButton>
              </Flex>
            ))}
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
