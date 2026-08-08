import { useCallback, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import { sourceForUrl } from "../utils/emoteImportSources";
import {
  downloadAsFileWithProgress,
  type ImportEmoteWithMeta,
  sanitizeName,
  validateName,
} from "../utils/emoteImportUtils";
import { stageEmojiViaXhr } from "../utils/stageEmojiViaXhr";
import { getFreshServerAccessToken, type TokenRefreshSocketLike } from "../utils/tokenManager";

interface UseEmoteImportParams {
  host: string;
  accessToken: string | null;
  socket: TokenRefreshSocketLike | null;
  existingNames: Set<string>;
}

export function useEmoteImport({
  host,
  accessToken,
  socket,
  existingNames,
}: UseEmoteImportParams) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [emotes, setEmotes] = useState<ImportEmoteWithMeta[]>([]);
  const [filterText, setFilterText] = useState("");

  const effectiveAccessToken = useMemo(
    () => accessToken || getServerAccessToken(host),
    [accessToken, host],
  );
  const base = useMemo(() => getServerHttpBase(host), [host]);

  const selectedEmotes = useMemo(
    () => emotes.filter((e) => e.selected),
    [emotes],
  );

  const validSelectedCount = useMemo(
    () => selectedEmotes.filter((e) => !e.nameError).length,
    [selectedEmotes],
  );

  const filteredEmotes = useMemo(() => {
    if (!filterText) return emotes;
    const lower = filterText.toLowerCase();
    return emotes.filter(
      (e) =>
        e.code.toLowerCase().includes(lower) ||
        e.name.toLowerCase().includes(lower),
    );
  }, [emotes, filterText]);

  const revalidateAll = useCallback(
    (items: ImportEmoteWithMeta[]): ImportEmoteWithMeta[] => {
      const selectedNames = items
        .filter((e) => e.selected)
        .map((e) => e.name);
      return items.map((e) => {
        if (!e.selected) return { ...e, nameError: null, nameWarning: null };
        const idx = selectedNames.indexOf(e.name);
        const { error, warning } = validateName(e.name, existingNames, selectedNames, idx);
        return { ...e, nameError: error, nameWarning: warning };
      });
    },
    [existingNames],
  );

  const handleFetch = useCallback(async () => {
    const trimmed = url.trim();
    const source = sourceForUrl(trimmed);
    if (!source) {
      toast.error(
        "Link not recognised. Paste a BetterTTV user or emote, or an emoji.gg user, pack or emoji.",
      );
      return;
    }

    setFetching(true);
    try {
      const listing = await source.fetchListing(trimmed, base);
      if (listing.emotes.length === 0) {
        toast.error(`No emotes found on that ${source.label} link.`);
        return;
      }

      const withMeta: ImportEmoteWithMeta[] = listing.emotes.map((e) => ({
        ...e,
        selected: true,
        name: sanitizeName(e.code),
        nameError: null,
        nameWarning: null,
        status: "idle",
        progress: 0,
        lastError: null,
      }));

      setEmotes(revalidateAll(withMeta));
      setUsername(listing.title);
      toast.success(`Found ${listing.emotes.length} emote(s)`);
      if (listing.note) toast(listing.note);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to fetch from ${source.label}.`,
      );
    } finally {
      setFetching(false);
    }
  }, [url, base, revalidateAll]);

  const toggleSelect = useCallback(
    (id: string) => {
      setEmotes((prev) => {
        const updated = prev.map((e) =>
          e.id === id ? { ...e, selected: !e.selected } : e,
        );
        return revalidateAll(updated);
      });
    },
    [revalidateAll],
  );

  const toggleAll = useCallback(
    (selected: boolean) => {
      setEmotes((prev) => {
        const updated = prev.map((e) => ({ ...e, selected }));
        return revalidateAll(updated);
      });
    },
    [revalidateAll],
  );

  const updateName = useCallback(
    (id: string, newName: string) => {
      const sanitized = newName.replace(/[^A-Za-z0-9_]/g, "");
      setEmotes((prev) => {
        const updated = prev.map((e) =>
          e.id === id ? { ...e, name: sanitized } : e,
        );
        return revalidateAll(updated);
      });
    },
    [revalidateAll],
  );

  const handleImport = useCallback(async () => {
    const toImportRaw = selectedEmotes.filter((e) => !e.nameError);
    if (toImportRaw.length === 0) return;
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return;
    }

    const byName = new Map<string, ImportEmoteWithMeta>();
    for (const e of toImportRaw) {
      if (byName.has(e.name)) byName.delete(e.name);
      byName.set(e.name, e);
    }
    const toImport = Array.from(byName.values());
    if (toImport.length !== toImportRaw.length) {
      toast(`Duplicate emoji IDs detected — importing ${toImport.length}/${toImportRaw.length} (last wins).`);
    }

    setImporting(true);
    try {
      let successCount = 0;

      const importOne = async (emote: ImportEmoteWithMeta) => {
        setEmotes((prev) => prev.map((e) => (
          e.id === emote.id
            ? { ...e, status: "downloading", progress: 0, lastError: null }
            : e
        )));

        try {
          const fallbackMime =
            emote.imageType === "gif" ? "image/gif"
              : emote.imageType === "webp" ? "image/webp"
              : "image/png";
          const file = await downloadAsFileWithProgress({
            url: emote.fileUrl,
            name: emote.name,
            fallbackMime,
            onProgress: (pct) => {
              setEmotes((prev) => prev.map((e) => (
                e.id === emote.id
                  ? { ...e, status: "downloading", progress: pct, lastError: null }
                  : e
              )));
            },
          });

          setEmotes((prev) => prev.map((e) => (
            e.id === emote.id
              ? { ...e, status: "uploading", progress: 0, lastError: null }
              : e
          )));

          const token = await getFreshServerAccessToken(host, socket);
          if (!token) throw new Error("Not authenticated. Join the server first.");

          let result = await stageEmojiViaXhr({
            base,
            accessToken: token,
            file,
            name: emote.name,
            onProgress: (pct) => {
              setEmotes((prev) => prev.map((e) => (
                e.id === emote.id
                  ? { ...e, status: "uploading", progress: pct }
                  : e
              )));
            },
            onUploadFinished: () => {
              setEmotes((prev) => prev.map((e) => (
                e.id === emote.id && e.status === "uploading"
                  ? { ...e, status: "processing", progress: 100 }
                  : e
              )));
            },
          });

          if (!result.ok && result.status === 401 && (result.error === "token_invalid" || result.error === "token_stale")) {
            const refreshed = await getFreshServerAccessToken(host, socket, { force: true });
            if (refreshed) {
              result = await stageEmojiViaXhr({
                base,
                accessToken: refreshed,
                file,
                name: emote.name,
                onProgress: (pct) => {
                  setEmotes((prev) => prev.map((e) => (
                    e.id === emote.id
                      ? { ...e, status: "uploading", progress: pct }
                      : e
                  )));
                },
                onUploadFinished: () => {
                  setEmotes((prev) => prev.map((e) => (
                    e.id === emote.id && e.status === "uploading"
                      ? { ...e, status: "processing", progress: 100 }
                      : e
                  )));
                },
              });
            }
          }

          if (result.ok) {
            successCount++;
            toast.success(`:${emote.name}: queued for processing.`);
            setEmotes((prev) => prev.filter((e) => e.id !== emote.id));
          } else {
          toast.error(`:${emote.name}: — ${result.message}`);
            setEmotes((prev) => prev.map((e) => (
              e.id === emote.id
                ? { ...e, status: "error", progress: 0, lastError: result.message }
                : e
            )));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Import failed.";
          toast.error(`:${emote.name}: — ${msg}`);
          setEmotes((prev) => prev.map((e) => (
            e.id === emote.id
              ? { ...e, status: "error", progress: 0, lastError: msg }
              : e
          )));
        }
      };

      const concurrencyLimit = Math.min(3, toImport.length);
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < toImport.length) {
          const i = nextIndex;
          nextIndex++;
          const emote = toImport[i];
          if (!emote) break;
          await importOne(emote);
        }
      };

      await Promise.all(Array.from({ length: concurrencyLimit }, worker));

      if (successCount > 0) {
        toast.success(`Imported ${successCount} emoji(s)!`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Import failed.",
      );
    } finally {
      setImporting(false);
    }
  }, [selectedEmotes, base, effectiveAccessToken, host, socket]);

  const handleClear = useCallback(() => {
    setEmotes([]);
    setUsername(null);
    setUrl("");
    setFilterText("");
  }, []);

  return {
    url,
    setUrl,
    fetching,
    importing,
    username,
    emotes,
    filterText,
    setFilterText,
    selectedEmotes,
    validSelectedCount,
    filteredEmotes,
    handleFetch,
    toggleSelect,
    toggleAll,
    updateName,
    handleImport,
    handleClear,
  };
}
