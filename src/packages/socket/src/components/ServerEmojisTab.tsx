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
import { stageEmojiViaXhr } from "../utils/stageEmojiViaXhr";
import { getFreshServerAccessToken } from "../utils/tokenManager";
import { BttvImport } from "./BttvImport";

const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;
const IMAGE_MIME_RE = /^image\/(png|jpeg|webp|gif|svg\+xml|avif)$/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;
const ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);
const DEFAULT_MAX_EMOJI_BYTES = 5 * 1024 * 1024;

type EmojiItem = { name: string; file_id: string };

interface PendingEmoji {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  nameError: string | null;
  nameWarning: string | null;
  status: "pending" | "uploading" | "processing" | "done" | "error";
  progress: number;
}

function deriveEmojiName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").replace(/^\d+[-_]/, "");
  const sanitized = base.replace(/[^A-Za-z0-9_]/g, "_");
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

async function extractImagesFromZip(zipFile: File, maxEmojiBytes: number): Promise<{
  images: File[];
  skippedNonImage: number;
  skippedTooLarge: number;
  skippedEmpty: number;
}> {
  const buf = await zipFile.arrayBuffer();
  const entries = unzipSync(new Uint8Array(buf));
  const images: File[] = [];
  let skippedNonImage = 0;
  let skippedTooLarge = 0;
  let skippedEmpty = 0;

  for (const [path, data] of Object.entries(entries)) {
    if (path.startsWith("__MACOSX/") || path.endsWith("/")) continue;
    const filename = path.split("/").pop() || path;
    if (!IMAGE_EXT_RE.test(filename)) { skippedNonImage++; continue; }
    if (data.length === 0) { skippedEmpty++; continue; }
    if (data.length > maxEmojiBytes) { skippedTooLarge++; continue; }
    const ext = filename.split(".").pop() || "png";
    const mime = extToMime(ext);
    const copied = new Uint8Array(data) as BlobPart;
    images.push(new File([copied], filename, { type: mime }));
  }

  return { images, skippedNonImage, skippedTooLarge, skippedEmpty };
}

function validateName(
  name: string,
  existingNames: Set<string>,
  batchNames: string[],
  selfIndex: number,
): { error: string | null; warning: string | null } {
  if (!name) return { error: "Name is required.", warning: null };
  if (!EMOJI_NAME_RE.test(name)) return { error: "2-32 letters (case-sensitive), numbers, or underscores.", warning: null };
  for (let i = 0; i < batchNames.length; i++) {
    if (i !== selfIndex && batchNames[i] === name) return { error: null, warning: "Duplicate in selection — last one wins." };
  }
  if (existingNames.has(name)) return { error: null, warning: "Already exists — will replace." };
  return { error: null, warning: null };
}

export function ServerEmojisTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: {
    connected: boolean;
    emit: (event: string, data?: unknown) => void;
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
  };
  accessToken: string | null;
}) {
  const [lastSelectSummary, setLastSelectSummary] = useState<{
    selected: number;
    added: number;
    skippedTooLarge: number;
    skippedUnsupported: number;
    skippedZipNonImage: number;
    skippedZipTooLarge: number;
    skippedZipEmpty: number;
    tooLargeExamples: string[];
    unsupportedExamples: string[];
  } | null>(null);
  const [emojis, setEmojis] = useState<EmojiItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [emojiMaxBytes, setEmojiMaxBytes] = useState<number>(DEFAULT_MAX_EMOJI_BYTES);
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
    if (!socket || !socket.connected) return;

    const onEmojisUpdated = () => {
      void refresh();
    };

    const onSettings = (payload: unknown) => {
      const p = (payload && typeof payload === "object") ? (payload as Record<string, unknown>) : {};
      const v = p.emojiMaxBytes;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        setEmojiMaxBytes(v);
      }
    };

    socket.on("server:settings", onSettings);
    socket.on("server:emojis:updated", onEmojisUpdated);
    socket.emit("server:settings:get");

    return () => {
      socket.off("server:settings", onSettings);
      socket.off("server:emojis:updated", onEmojisUpdated);
    };
  }, [socket, refresh]);

  useEffect(() => {
    return () => {
      pendingEmojis.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addImageFiles = useCallback((validFiles: File[]) => {
    console.log("[EmojiUpload] addImageFiles:", validFiles.length, "file(s)", validFiles.map(f => ({ name: f.name, type: f.type, size: f.size })));
    if (validFiles.length === 0) { console.log("[EmojiUpload] addImageFiles: empty array, bailing"); return; }

    setPendingEmojis((prev) => {
      const newItems: PendingEmoji[] = validFiles.map((file, i) => {
        const name = deriveEmojiName(file.name);
        return {
          id: `emoji-${Date.now()}-${Math.random().toString(36).slice(2)}-${i}`,
          file,
          previewUrl: URL.createObjectURL(file),
          name,
          nameError: null,
          nameWarning: null,
          status: "pending",
          progress: 0,
        };
      });

      // Keep the pending list unique by name — last selection wins.
      const byName = new Map<string, PendingEmoji>();
      for (const item of [...prev, ...newItems]) {
        const existing = byName.get(item.name);
        if (existing) {
          URL.revokeObjectURL(existing.previewUrl);
          byName.delete(item.name);
        }
        byName.set(item.name, item);
      }

      const deduped = Array.from(byName.values());
      const batchNames = deduped.map((p) => p.name);
      return deduped.map((p, idx) => {
        const { error, warning } = validateName(p.name, existingNames, batchNames, idx);
        return { ...p, nameError: error, nameWarning: warning };
      });
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
    let skippedTooLarge = 0;
    let skippedUnsupported = 0;
    let skippedZipNonImage = 0;
    let skippedZipTooLarge = 0;
    let skippedZipEmpty = 0;
    const tooLargeExamples: string[] = [];
    const unsupportedExamples: string[] = [];

    for (const f of files) {
      const isImage = IMAGE_MIME_RE.test(f.type) || IMAGE_EXT_RE.test(f.name);
      const isZip = isZipFile(f);
      console.log("[EmojiUpload] handleFileSelect: file:", f.name, "type:", f.type, "size:", f.size, "isImage:", isImage, "isZip:", isZip);
      if (isZip) {
        zipFiles.push(f);
      } else if (isImage) {
        if (f.size > emojiMaxBytes) {
          skippedTooLarge++;
          if (tooLargeExamples.length < 3) tooLargeExamples.push(f.name);
          continue;
        }
        imageFiles.push(f);
      } else {
        console.warn("[EmojiUpload] handleFileSelect: rejected file:", f.name, "type:", f.type);
        skippedUnsupported++;
        if (unsupportedExamples.length < 3) unsupportedExamples.push(f.name);
      }
    }

    for (const zip of zipFiles) {
      try {
        const extracted = await extractImagesFromZip(zip, emojiMaxBytes);
        skippedZipNonImage += extracted.skippedNonImage;
        skippedZipTooLarge += extracted.skippedTooLarge;
        skippedZipEmpty += extracted.skippedEmpty;
        if (extracted.images.length === 0) {
          toast.error(`"${zip.name}": no valid images found in archive.`);
        } else {
          toast.success(`Extracted ${extracted.images.length} image(s) from "${zip.name}".`);
          imageFiles.push(...extracted.images);
        }
      } catch (err) {
        console.error("[EmojiUpload] handleFileSelect: zip extraction failed:", zip.name, err);
        toast.error(`"${zip.name}": failed to read archive.`);
      }
    }

    console.log("[EmojiUpload] handleFileSelect: passing", imageFiles.length, "image(s) to addImageFiles");
    const selected = files.length;
    const added = imageFiles.length;
    setLastSelectSummary({
      selected,
      added,
      skippedTooLarge,
      skippedUnsupported,
      skippedZipNonImage,
      skippedZipTooLarge,
      skippedZipEmpty,
      tooLargeExamples,
      unsupportedExamples,
    });
    const skippedTotal = skippedTooLarge + skippedUnsupported + skippedZipNonImage + skippedZipTooLarge + skippedZipEmpty;
    if (skippedTotal > 0) {
      const parts = [
        skippedTooLarge > 0 ? `${skippedTooLarge} too large (>${Math.round((emojiMaxBytes / (1024 * 1024)) * 10) / 10} MB)` : null,
        skippedUnsupported > 0 ? `${skippedUnsupported} unsupported` : null,
        (skippedZipTooLarge + skippedZipEmpty) > 0 ? `${skippedZipTooLarge + skippedZipEmpty} zip entries too large/empty` : null,
      ].filter((p): p is string => p !== null);
      toast.error(`Skipped ${skippedTotal} item(s). ${parts.join(", ")}`);
    }
    addImageFiles(imageFiles);
  };

  const updatePendingName = (id: string, newName: string) => {
    const sanitized = newName.replace(/[^A-Za-z0-9_]/g, "");
    setPendingEmojis((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1) return prev;
      const updated = prev.map((p, i) => (i === idx ? { ...p, name: sanitized } : p));

      // Enforce “last wins” if the rename creates duplicates: keep this item.
      const duplicates = updated.filter((p) => p.id !== id && p.name === sanitized);
      for (const d of duplicates) URL.revokeObjectURL(d.previewUrl);

      const remaining = updated.filter((p) => !(p.id !== id && p.name === sanitized));
      const batchNames = remaining.map((p) => p.name);
      return remaining.map((p, i) => {
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

  const uploadOne = async (item: PendingEmoji): Promise<boolean> => {
    const token = await getFreshServerAccessToken(host, socket);
    if (!token) {
      toast.error("Not authenticated. Join the server first.");
      return false;
    }

    console.log("[EmojiUpload] uploadOne: start", {
      id: item.id,
      name: item.name,
      fileName: item.file.name,
      type: item.file.type,
      size: item.file.size,
      base,
    });
    setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading", progress: 0 } : p)));

    const startedAt = Date.now();
    let lastLoggedMilestone = -1;

    let result = await stageEmojiViaXhr({
      base,
      accessToken: token,
      file: item.file,
      name: item.name,
      onProgress: (pct) => {
        const milestone = Math.floor(pct / 25) * 25;
        if (milestone !== lastLoggedMilestone) {
          lastLoggedMilestone = milestone;
          console.log("[EmojiUpload] uploadOne: progress", { id: item.id, name: item.name, pct });
        }
        setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p)));
      },
      onUploadFinished: () => {
        // Upload finished; waiting for server to acknowledge queueing.
        console.log("[EmojiUpload] uploadOne: upload finished; waiting for queue response", { id: item.id, name: item.name });
        setPendingEmojis((prev) => prev.map((p) => (
          p.id === item.id && p.status === "uploading"
            ? { ...p, status: "processing", progress: 100 }
            : p
        )));
      },
    });

    if (!result.ok && result.status === 401 && (result.error === "token_invalid" || result.error === "token_stale")) {
      const refreshed = await getFreshServerAccessToken(host, socket, { force: true });
      if (refreshed) {
        result = await stageEmojiViaXhr({
          base,
          accessToken: refreshed,
          file: item.file,
          name: item.name,
          onProgress: (pct) => {
            const milestone = Math.floor(pct / 25) * 25;
            if (milestone !== lastLoggedMilestone) {
              lastLoggedMilestone = milestone;
              console.log("[EmojiUpload] uploadOne: progress", { id: item.id, name: item.name, pct });
            }
            setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p)));
          },
          onUploadFinished: () => {
            console.log("[EmojiUpload] uploadOne: upload finished; waiting for queue response", { id: item.id, name: item.name });
            setPendingEmojis((prev) => prev.map((p) => (
              p.id === item.id && p.status === "uploading"
                ? { ...p, status: "processing", progress: 100 }
                : p
            )));
          },
        });
      }
    }

    console.log("[EmojiUpload] uploadOne: server response", {
      id: item.id,
      name: item.name,
      status: result.status,
      ok: result.ok,
      ms: Date.now() - startedAt,
    });

    if (result.ok) {
      toast.success(`Emoji :${item.name}: queued for processing.`);
      setPendingEmojis((prev) => {
        const existing = prev.find((p) => p.id === item.id);
        if (existing) URL.revokeObjectURL(existing.previewUrl);
        const remaining = prev.filter((p) => p.id !== item.id);
        const batchNames = remaining.map((p) => p.name);
        console.log("[EmojiUpload] uploadOne: removed from pending", { id: item.id, name: item.name, remaining: remaining.length });
        return remaining.map((p, i) => {
          const { error, warning } = validateName(p.name, existingNames, batchNames, i);
          return { ...p, nameError: error, nameWarning: warning };
        });
      });
      return true;
    }

    toast.error(`:${item.name}: — ${result.message}`);
    setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "error", progress: 0 } : p)));
    return false;
  };

  const handleUploadAll = async () => {
    const toUpload = pendingEmojis.filter((p) => p.status === "pending" && !p.nameError);
    if (toUpload.length === 0) return;
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return;
    }

    console.log("[EmojiUpload] handleUploadAll: start", {
      totalPending: pendingEmojis.length,
      toUpload: toUpload.length,
    });
    setUploading(true);
    const concurrencyLimit = Math.min(6, toUpload.length);
    let nextIndex = 0;
    let successCount = 0;

    const worker = async () => {
      while (nextIndex < toUpload.length) {
        const i = nextIndex;
        nextIndex++;
        const item = toUpload[i];
        if (!item) break;
        console.log("[EmojiUpload] handleUploadAll: worker uploading", { idx: i, id: item.id, name: item.name });
        const ok = await uploadOne(item);
        if (ok) successCount++;
      }
    };

    await Promise.all(Array.from({ length: concurrencyLimit }, worker));

    if (successCount > 0) {
      toast.success(`Queued ${successCount} emoji(s) for processing.`);
    }

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
    await uploadOne(item);
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
    const newName = editingName.trim();
    if (newName === editingEmoji) { cancelEditing(); return; }
    if (!EMOJI_NAME_RE.test(newName)) {
      setEditingError("2-32 letters (case-sensitive), numbers, or underscores.");
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

        {lastSelectSummary && (() => {
          const skippedTotal = lastSelectSummary.skippedTooLarge +
            lastSelectSummary.skippedUnsupported +
            lastSelectSummary.skippedZipNonImage +
            lastSelectSummary.skippedZipTooLarge +
            lastSelectSummary.skippedZipEmpty;
          if (skippedTotal === 0) return null;
          const parts: string[] = [];
          if (lastSelectSummary.tooLargeExamples.length > 0) parts.push(`Too large: ${lastSelectSummary.tooLargeExamples.join(", ")}`);
          if (lastSelectSummary.unsupportedExamples.length > 0) parts.push(`Unsupported: ${lastSelectSummary.unsupportedExamples.join(", ")}`);
          return (
            <Text size="1" color="yellow">
              Skipped {skippedTotal} item(s) from your selection{parts.length > 0 ? ` (${parts.join(" · ")})` : ""}.
            </Text>
          );
        })()}

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
                }}
              >
                <div
                  className="emoji-upload-preview-wrap"
                  aria-busy={p.status === "uploading" || p.status === "processing"}
                  data-status={p.status}
                >
                  <img
                    src={p.previewUrl}
                    alt="preview"
                    className="emoji-upload-preview-img"
                  />
                  {(p.status === "uploading" || p.status === "processing") && (
                    <div className="emoji-upload-preview-overlay" aria-hidden="true">
                      <div className="emoji-upload-preview-label">
                        {p.status === "processing" ? "Converting…" : `${p.progress}%`}
                      </div>
                      <div className="emoji-upload-preview-bar">
                        <div
                          className="emoji-upload-preview-bar-inner"
                          style={{ width: `${p.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
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
        socket={socket ?? null}
        existingNames={existingNames}
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
                          const v = ev.target.value.replace(/[^A-Za-z0-9_]/g, "");
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
