import {
  Badge,
  Button,
  Checkbox,
  Flex,
  Text,
  TextField,
} from "@radix-ui/themes";
import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { MdClose, MdDownload, MdSearch } from "react-icons/md";

import { getServerAccessToken, getServerHttpBase } from "@/common";

const BTTV_USER_URL_RE = /betterttv\.com\/users\/([a-f0-9]{20,30})/;
const BTTV_EMOTE_URL_RE = /betterttv\.com\/emotes\/([a-f0-9]{20,30})/;
const BTTV_CDN = "https://cdn.betterttv.net/emote";
const EMOJI_NAME_RE = /^[A-Za-z0-9_]{2,32}$/;

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
}

function sanitizeName(code: string): string {
  const sanitized = code.replace(/[^A-Za-z0-9_]/g, "_");
  const trimmed = sanitized.replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_");
  if (trimmed.length < 2) return trimmed.padEnd(2, "_");
  return trimmed.slice(0, 32);
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
      const resp = await fetch(`${base}/api/emojis/bttv/import`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${effectiveAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          emotes: toImport.map((e) => ({
            id: e.id,
            code: e.code,
            imageType: e.imageType,
            name: e.name,
          })),
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok && !data.results) {
        throw new Error(
          (typeof data?.message === "string" && data.message) ||
            `Import failed (${resp.status})`,
        );
      }

      const results: Array<{ name: string; ok: boolean; message?: string }> =
        data.results || [];
      const successCount = results.filter((r) => r.ok).length;
      const failCount = results.filter((r) => !r.ok).length;

      if (successCount > 0) {
        toast.success(`Imported ${successCount} emoji(s)!`);
      }
      if (failCount > 0) {
        const failures = results.filter((r) => !r.ok);
        for (const f of failures.slice(0, 3)) {
          toast.error(`:${f.name}: — ${f.message || "Failed"}`);
        }
        if (failures.length > 3) {
          toast.error(`…and ${failures.length - 3} more failed.`);
        }
      }

      setEmotes((prev) => {
        const successNames = new Set(
          results.filter((r) => r.ok).map((r) => r.name),
        );
        return prev.filter((e) => !successNames.has(e.name));
      });
      onImportComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Import failed.",
      );
    } finally {
      setImporting(false);
    }
  }, [selectedEmotes, effectiveAccessToken, base, onImportComplete]);

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
                <img
                  src={`${BTTV_CDN}/${e.id}/2x`}
                  alt={e.code}
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: "contain",
                    borderRadius: "var(--radius-1)",
                    flexShrink: 0,
                  }}
                />
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
