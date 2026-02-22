import { TrashIcon } from "@radix-ui/react-icons";
import {
  Button,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import {
  fetchCustomEmojis,
  getCustomEmojiUrl,
  setCustomEmojis,
} from "../utils/emojiData";

const EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;

type EmojiItem = { name: string; file_id: string };

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

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveAccessToken = useMemo(
    () => accessToken || getServerAccessToken(host),
    [accessToken, host],
  );

  const base = useMemo(() => getServerHttpBase(host), [host]);

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
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setName(v);
    if (v.length > 0 && !EMOJI_NAME_RE.test(v)) {
      setNameError("2-32 lowercase letters, numbers, or underscores.");
    } else {
      setNameError(null);
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(f.type)) {
      toast.error("Unsupported format. Use PNG, JPEG, WebP, or GIF.");
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error("File too large (max 5 MB).");
      return;
    }
    setSelectedFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
    e.currentTarget.value = "";
  };

  const handleUpload = async () => {
    if (!selectedFile || !name) return;
    if (!EMOJI_NAME_RE.test(name)) {
      setNameError("2-32 lowercase letters, numbers, or underscores.");
      return;
    }
    if (!effectiveAccessToken) {
      toast.error("Not authenticated. Join the server first.");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", selectedFile);
      form.append("name", name);

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

      toast.success(`Emoji :${name}: uploaded!`);
      setName("");
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      await refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Emoji upload failed.");
    } finally {
      setUploading(false);
    }
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
        <Text size="2" weight="medium">
          Upload new emoji
        </Text>

        <Flex gap="3" align="end" wrap="wrap">
          <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 160 }}>
            <Text size="1" color="gray">
              Shortcode
            </Text>
            <TextField.Root
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. pepehappy"
              disabled={uploading}
            />
            {nameError && (
              <Text size="1" color="red">
                {nameError}
              </Text>
            )}
          </Flex>

          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              Image
            </Text>
            <Flex align="center" gap="2">
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="preview"
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: "contain",
                    borderRadius: "var(--radius-1)",
                  }}
                />
              )}
              <Button
                variant="soft"
                size="1"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {selectedFile ? "Change" : "Choose file"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
            </Flex>
          </Flex>

          <Button
            onClick={handleUpload}
            disabled={uploading || !selectedFile || !name || !!nameError}
          >
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </Flex>
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
