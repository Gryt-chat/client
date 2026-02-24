import {
  Badge,
  Button,
  Checkbox,
  Flex,
  Text,
  TextField,
} from "@radix-ui/themes";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MdClose, MdDownload, MdSearch } from "react-icons/md";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import { uploadEmojiViaXhr } from "../utils/uploadEmojiViaXhr";

const BTTV_USER_URL_RE = /betterttv\.com\/users\/([a-f0-9]{20,30})/;
const BTTV_EMOTE_URL_RE = /betterttv\.com\/emotes\/([a-f0-9]{20,30})/;
const BTTV_CDN = "https://cdn.betterttv.net/emote";
const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;

type EmoteImportStatus = "idle" | "downloading" | "uploading" | "processing" | "error";

interface BttvEmote {
  id: string;
  code: string;
  imageType: string;
  animated: boolean;
}

interface BttvEmoteWithMeta extends BttvEmote {
  selected: boolean;
  name: string;
  nameError: string | null;
  nameWarning: string | null;
  status: EmoteImportStatus;
  progress: number;
  lastError: string | null;
}

function sanitizeName(code: string): string {
  const sanitized = code.replace(/[^A-Za-z0-9_]/g, "_");
  const trimmed = sanitized.replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
  if (trimmed.length < 2) return trimmed.padEnd(2, "_");
  return trimmed.slice(0, 32);
}

function mimeToExt(mime: string): string | null {
  const lower = mime.toLowerCase();
  if (lower === "image/png") return "png";
  if (lower === "image/jpeg") return "jpg";
  if (lower === "image/gif") return "gif";
  if (lower === "image/webp") return "webp";
  if (lower === "image/avif") return "avif";
  if (lower === "image/svg+xml") return "svg";
  return null;
}

async function downloadAsFileWithProgress({
  url,
  name,
  fallbackMime,
  onProgress,
}: {
  url: string;
  name: string;
  fallbackMime: string;
  onProgress: (pct: number) => void;
}): Promise<File> {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    const data: unknown = await resp.json().catch(() => null);
    const root = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
    const msg = typeof root.message === "string" ? root.message : `Failed to fetch emote file (${resp.status})`;
    throw new Error(msg);
  }

  const mime = resp.headers.get("content-type") || fallbackMime;
  const ext = mimeToExt(mime) ?? "bin";
  const contentLengthHeader = resp.headers.get("content-length");
  const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : null;

  const body = resp.body;
  if (!body) {
    const blob = await resp.blob();
    onProgress(100);
    return new File([blob], `${name}.${ext}`, { type: mime });
  }

  const reader = body.getReader();
  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  let received = 0;
  onProgress(0);

  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    const value = result.value;
    if (!value) continue;

    // Copy into an ArrayBuffer-backed Uint8Array (avoids SharedArrayBuffer typing issues).
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    chunks.push(copy);
    received += value.byteLength;
    if (typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0) {
      const pct = Math.round((received / totalBytes) * 100);
      onProgress(Math.max(0, Math.min(100, pct)));
    } else {
      // Unknown total size; show “activity” by snapping to 99 until finished.
      onProgress(Math.min(99, Math.max(1, Math.round(received / 1024))));
    }
  }

  onProgress(100);
  const blob = new Blob(chunks, { type: mime });
  return new File([blob], `${name}.${ext}`, { type: mime });
}

function validateName(
  name: string,
  existingNames: Set<string>,
  batchNames: string[],
  selfIndex: number,
): { error: string | null; warning: string | null } {
  if (!name) return { error: "Name is required.", warning: null };
  if (!EMOJI_NAME_RE.test(name))
    return { error: "2-32 letters (case-sensitive), numbers, or underscores.", warning: null };
  for (let i = 0; i < batchNames.length; i++) {
    if (i !== selfIndex && batchNames[i] === name)
      return { error: "Duplicate name in batch.", warning: null };
  }
  if (existingNames.has(name))
    return { error: null, warning: "Already exists — will replace." };
  return { error: null, warning: null };
}

export function BttvImport({
  host,
  accessToken,
  existingNames,
  onImportComplete,
}: {
  host: string;
  accessToken: string | null;
  existingNames: Set<string>;
  onImportComplete: () => void;
}) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [emotes, setEmotes] = useState<BttvEmoteWithMeta[]>([]);
  const [filterText, setFilterText] = useState("");

  const effectiveAccessToken = useMemo(
    () => accessToken || getServerAccessToken(host),
    [accessToken, host],
  );
  const base = useMemo(() => getServerHttpBase(host), [host]);

  const refreshTimerRef = useRef<number | null>(null);
  const requestRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      onImportComplete();
    }, 350);
  }, [onImportComplete]);

  useEffect(() => {
    return () => {
      if (typeof refreshTimerRef.current === "number") window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, []);

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
    (items: BttvEmoteWithMeta[]): BttvEmoteWithMeta[] => {
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
    const userMatch = trimmed.match(BTTV_USER_URL_RE);
    const emoteMatch = trimmed.match(BTTV_EMOTE_URL_RE);
    if (!userMatch && !emoteMatch) {
      toast.error("Invalid BetterTTV URL. Expected: https://betterttv.com/users/... or https://betterttv.com/emotes/...");
      return;
    }

    setFetching(true);
    try {
      if (emoteMatch) {
        const emoteId = emoteMatch[1];
        const resp = await fetch(`${base}/api/emojis/bttv/emote/${emoteId}`);
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(
            (typeof data?.message === "string" && data.message) ||
              `Failed to fetch (${resp.status})`,
          );
        }
        const data: unknown = await resp.json();
        const root = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
        const emoteRaw = (root.emote && typeof root.emote === "object") ? (root.emote as Record<string, unknown>) : null;
        const id = typeof emoteRaw?.id === "string" ? emoteRaw.id : emoteId;
        const code = typeof emoteRaw?.code === "string" ? emoteRaw.code : "";
        const imageType = typeof emoteRaw?.imageType === "string" ? emoteRaw.imageType : "png";
        const animated = typeof emoteRaw?.animated === "boolean" ? emoteRaw.animated : imageType.toLowerCase() === "gif";
        if (!code) throw new Error("BetterTTV returned an invalid emote payload.");

        const withMeta: BttvEmoteWithMeta[] = [
          {
            id,
            code,
            imageType,
            animated,
            selected: true,
            name: sanitizeName(code),
            nameError: null,
            nameWarning: null,
            status: "idle",
            progress: 0,
            lastError: null,
          },
        ];
        const validated = revalidateAll(withMeta);
        setEmotes(validated);
        setUsername("Single emote");
        toast.success("Found 1 emote");
      } else if (userMatch) {
        const userId = userMatch[1];
        const resp = await fetch(`${base}/api/emojis/bttv/user/${userId}`);
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(
            (typeof data?.message === "string" && data.message) ||
              `Failed to fetch (${resp.status})`,
          );
        }
        const data = await resp.json();
        const all: BttvEmote[] = [
          ...(data.channelEmotes || []),
          ...(data.sharedEmotes || []),
        ];
        if (all.length === 0) {
          toast.error("No emotes found for this user.");
          setFetching(false);
          return;
        }
        const withMeta: BttvEmoteWithMeta[] = all.map((e) => ({
          ...e,
          selected: true,
          name: sanitizeName(e.code),
          nameError: null,
          nameWarning: null,
          status: "idle",
          progress: 0,
          lastError: null,
        }));
        const validated = revalidateAll(withMeta);
        setEmotes(validated);
        setUsername(data.username || null);
        toast.success(`Found ${all.length} emote(s)`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to fetch BetterTTV emotes.",
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
    const toImport = selectedEmotes.filter((e) => !e.nameError);
    if (toImport.length === 0) return;
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return;
    }

    setImporting(true);
    try {
      const startedAt = Date.now();
      console.log("[BttvImport] start", { count: toImport.length });

      let successCount = 0;
      let failCount = 0;

      const importOne = async (emote: BttvEmoteWithMeta) => {
        console.log("[BttvImport] emote: start", { id: emote.id, name: emote.name, code: emote.code });
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
            url: `${base}/api/emojis/bttv/file/${emote.id}`,
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

          const uploadStartedAt = Date.now();
          const result = await uploadEmojiViaXhr({
            base,
            accessToken: effectiveAccessToken,
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

          console.log("[BttvImport] emote: upload result", {
            id: emote.id,
            name: emote.name,
            ok: result.ok,
            status: result.status,
            ms: Date.now() - uploadStartedAt,
          });

          if (result.ok) {
            successCount++;
            toast.success(`:${emote.name}: imported!`);
            setEmotes((prev) => prev.filter((e) => e.id !== emote.id));
            requestRefresh();
          } else {
            failCount++;
            toast.error(`:${emote.name}: — ${result.message}`);
            setEmotes((prev) => prev.map((e) => (
              e.id === emote.id
                ? { ...e, status: "error", progress: 0, lastError: result.message }
                : e
            )));
          }
        } catch (err) {
          failCount++;
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

      console.log("[BttvImport] done", { successCount, failCount, ms: Date.now() - startedAt });
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
  }, [selectedEmotes, effectiveAccessToken, base, requestRefresh]);

  const handleClear = useCallback(() => {
    setEmotes([]);
    setUsername(null);
    setUrl("");
    setFilterText("");
  }, []);

  return (
    <Flex
      direction="column"
      gap="3"
      p="3"
      style={{
        border: "1px solid var(--gray-a5)",
        borderRadius: "var(--radius-2)",
      }}
    >
      <Text size="2" weight="medium">
        Import from BetterTTV
      </Text>

      <Flex gap="2" align="center">
        <TextField.Root
          size="1"
          placeholder="https://betterttv.com/users/... or https://betterttv.com/emotes/..."
          value={url}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter") handleFetch();
          }}
          disabled={fetching || importing}
          style={{ flex: 1 }}
        />
        <Button
          size="1"
          variant="soft"
          disabled={fetching || importing || !url.trim()}
          onClick={handleFetch}
        >
          {fetching ? "Fetching..." : "Fetch"}
        </Button>
      </Flex>

      {emotes.length > 0 && (
        <>
          <Flex justify="between" align="center" gap="2">
            <Flex align="center" gap="2">
              {username && (
                <Text size="1" color="gray">
                  {username}
                </Text>
              )}
              <Badge size="1" variant="soft">
                {emotes.length} emote{emotes.length !== 1 && "s"}
              </Badge>
              <Badge size="1" variant="soft" color="green">
                {selectedEmotes.length} selected
              </Badge>
            </Flex>
            <Flex gap="2">
              <Button
                size="1"
                variant="ghost"
                onClick={() => toggleAll(true)}
                disabled={importing}
              >
                Select all
              </Button>
              <Button
                size="1"
                variant="ghost"
                onClick={() => toggleAll(false)}
                disabled={importing}
              >
                Deselect all
              </Button>
            </Flex>
          </Flex>

          {emotes.length > 10 && (
            <TextField.Root
              size="1"
              placeholder="Filter emotes..."
              value={filterText}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setFilterText(e.target.value)
              }
            >
              <TextField.Slot>
                <MdSearch size={14} />
              </TextField.Slot>
            </TextField.Root>
          )}

          <Flex
            direction="column"
            gap="1"
            style={{ maxHeight: 400, overflowY: "auto" }}
          >
            {filteredEmotes.map((e) => (
              <Flex
                key={e.id}
                align="center"
                gap="2"
                py="1"
                px="2"
                style={{
                  border: "1px solid var(--gray-a4)",
                  borderRadius: "var(--radius-1)",
                  opacity: e.selected ? 1 : 0.5,
                }}
              >
                <Checkbox
                  size="1"
                  checked={e.selected}
                  onCheckedChange={() => toggleSelect(e.id)}
                  disabled={importing}
                />
                <div
                  className="emoji-upload-preview-wrap"
                  data-status={
                    e.status === "processing"
                      ? "processing"
                      : (e.status === "uploading" || e.status === "downloading")
                        ? "uploading"
                        : undefined
                  }
                >
                  <img
                    className="emoji-upload-preview-img"
                    src={`${BTTV_CDN}/${e.id}/2x`}
                    alt={e.code}
                  />
                  {(e.status === "downloading" || e.status === "uploading" || e.status === "processing") && (
                    <div className="emoji-upload-preview-overlay">
                      <div className="emoji-upload-preview-label">
                        {e.status === "downloading"
                          ? `DL ${e.progress}%`
                          : e.status === "processing"
                            ? "PROC"
                            : `${e.progress}%`}
                      </div>
                      {(e.status === "downloading" || e.status === "uploading" || e.status === "processing") && (
                        <div className="emoji-upload-preview-bar">
                          <div
                            className="emoji-upload-preview-bar-inner"
                            style={{ width: `${e.status === "processing" ? 100 : e.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <Flex
                  direction="column"
                  gap="1"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Flex align="center" gap="1">
                    <TextField.Root
                      size="1"
                      value={e.name}
                      onChange={(ev: ChangeEvent<HTMLInputElement>) =>
                        updateName(e.id, ev.target.value)
                      }
                      placeholder="shortcode"
                      disabled={importing || !e.selected}
                      style={{ flex: 1 }}
                    />
                    {e.code !== e.name && (
                      <Text
                        size="1"
                        color="gray"
                        style={{
                          flexShrink: 0,
                          maxWidth: 100,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.code}
                      </Text>
                    )}
                  </Flex>
                  {e.selected && e.nameError && (
                    <Text size="1" color="red" style={{ lineHeight: 1.2 }}>
                      {e.nameError}
                    </Text>
                  )}
                  {e.selected && !e.nameError && e.nameWarning && (
                    <Text size="1" color="yellow" style={{ lineHeight: 1.2 }}>
                      {e.nameWarning}
                    </Text>
                  )}
                  {e.selected && e.status === "error" && e.lastError && (
                    <Text size="1" color="red" style={{ lineHeight: 1.2 }}>
                      {e.lastError}
                    </Text>
                  )}
                </Flex>
                {e.animated && (
                  <Badge size="1" variant="soft" color="purple">
                    GIF
                  </Badge>
                )}
              </Flex>
            ))}
          </Flex>

          <Flex justify="end" gap="2">
            <Button
              variant="soft"
              color="gray"
              size="1"
              disabled={importing}
              onClick={handleClear}
            >
              <MdClose size={14} /> Clear
            </Button>
            <Button
              size="1"
              disabled={importing || validSelectedCount === 0}
              onClick={handleImport}
            >
              <MdDownload size={14} />
              {importing
                ? "Importing..."
                : `Import ${validSelectedCount} emoji${validSelectedCount !== 1 ? "s" : ""}`}
            </Button>
          </Flex>
        </>
      )}
    </Flex>
  );
}
