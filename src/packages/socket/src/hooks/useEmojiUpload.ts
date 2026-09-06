import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getServerHttpBase } from "@/common";

import type { PendingEmoji } from "../utils/emojiFileUtils";
import {
  deriveEmojiName,
  extractImagesFromZip,
  isImageFile,
  isZipFile,
  validateName,
} from "../utils/emojiFileUtils";
import { stageEmojiViaXhr } from "../utils/stageEmojiViaXhr";
import { getFreshServerAccessToken, type TokenRefreshSocketLike } from "../utils/tokenManager";

export interface SelectSummary {
  selected: number;
  added: number;
  skippedTooLarge: number;
  skippedUnsupported: number;
  skippedZipNonImage: number;
  skippedZipTooLarge: number;
  skippedZipEmpty: number;
  tooLargeExamples: string[];
  unsupportedExamples: string[];
}

interface UseEmojiUploadParams {
  host: string;
  socket: TokenRefreshSocketLike | undefined;
  existingNames: Set<string>;
  emojiMaxBytes: number;
}

export function useEmojiUpload({
  host,
  socket,
  existingNames,
  emojiMaxBytes,
}: UseEmojiUploadParams) {
  const [pendingEmojis, setPendingEmojis] = useState<PendingEmoji[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lastSelectSummary, setLastSelectSummary] = useState<SelectSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const base = getServerHttpBase(host);

  useEffect(() => {
    return () => {
      pendingEmojis.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addImageFiles = useCallback((validFiles: File[]) => {
    if (validFiles.length === 0) return;

    setPendingEmojis((prev) => {
      const newItems: PendingEmoji[] = validFiles.map((file, i) => ({
        id: `emoji-${Date.now()}-${Math.random().toString(36).slice(2)}-${i}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: deriveEmojiName(file.name),
        nameError: null,
        nameWarning: null,
        status: "pending",
        progress: 0,
      }));

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
    if (!liveFiles || liveFiles.length === 0) return;
    const files = Array.from(liveFiles);
    e.currentTarget.value = "";

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
      if (isZipFile(f)) {
        zipFiles.push(f);
      } else if (isImageFile(f)) {
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

    setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading", progress: 0 } : p)));

    const xhrArgs = {
      base,
      accessToken: token,
      file: item.file,
      name: item.name,
      onProgress: (pct: number) => {
        setPendingEmojis((prev) => prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p)));
      },
      onUploadFinished: () => {
        setPendingEmojis((prev) => prev.map((p) => (
          p.id === item.id && p.status === "uploading"
            ? { ...p, status: "processing" as const, progress: 100 }
            : p
        )));
      },
    };

    let result = await stageEmojiViaXhr(xhrArgs);

    if (!result.ok && result.status === 401 && (result.error === "token_invalid" || result.error === "token_stale")) {
      const refreshed = await getFreshServerAccessToken(host, socket, { force: true });
      if (refreshed) {
        result = await stageEmojiViaXhr({ ...xhrArgs, accessToken: refreshed });
      }
    }

    /*
     * Wait out a refusal rather than failing the emoji.
     *
     * Importing a pack is one request per emoji at six in flight, so a pack of
     * any size will meet the server's write limit partway through. Giving up on
     * the first 429 failed every emoji after that point and left the import
     * half done, which is what "Too many requests" looked like from the outside.
     *
     * Two attempts, on the delay the server asked for. The limit is a window,
     * so waiting it out is the whole fix; retrying sooner or more often would
     * only spend the next window early.
     *
     * The row stays "uploading" throughout, which is what it still is from the
     * outside. A status of its own would need every consumer of that union to
     * learn a state that only means "the same thing, shortly".
     */
    for (let attempt = 0; attempt < 2; attempt++) {
      // Bound to a const so the refusal branch narrows; `result` is reassigned
      // below, which widens it again at the top of every iteration.
      const refused = result;
      if (refused.ok || refused.status !== 429) break;
      await new Promise((r) => setTimeout(r, refused.retryAfterMs ?? 5_000));
      result = await stageEmojiViaXhr(xhrArgs);
    }

    if (result.ok) {
      toast.success(`Emoji :${item.name}: queued for processing.`);
      setPendingEmojis((prev) => {
        const existing = prev.find((p) => p.id === item.id);
        if (existing) URL.revokeObjectURL(existing.previewUrl);
        const remaining = prev.filter((p) => p.id !== item.id);
        const batchNames = remaining.map((p) => p.name);
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

  const handleUploadAll = async (effectiveAccessToken: string | null) => {
    const toUpload = pendingEmojis.filter((p) => p.status === "pending" && !p.nameError);
    if (toUpload.length === 0) return;
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return;
    }

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
    if (!item || item.nameError) return;

    setUploading(true);
    await uploadOne(item);
    setUploading(false);
  };

  const clearAllPending = () => {
    pendingEmojis.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPendingEmojis([]);
  };

  const uploadableCount = pendingEmojis.filter((p) => p.status === "pending" && !p.nameError).length;

  return {
    pendingEmojis,
    uploading,
    lastSelectSummary,
    fileInputRef,
    uploadableCount,
    addImageFiles,
    handleFileSelect,
    updatePendingName,
    removePending,
    handleUploadAll,
    handleUploadSingle,
    clearAllPending,
  };
}
