import { Button, IconButton, TextField } from "@gryt/ui";
import {
  AlertDialog,
  Flex,
  Text,
} from "@radix-ui/themes";
import { type ChangeEvent, useState } from "react";
import toast from "react-hot-toast";
import { PiCheck, PiPencilSimpleFill, PiTrashFill, PiX } from "react-icons/pi";

import { getServerHttpBase } from "@/common";

import { getCustomEmojiUrl } from "../utils/emojiData";
import type { EmojiItem } from "../utils/emojiFileUtils";
import { EMOJI_NAME_RE } from "../utils/emojiFileUtils";

interface EmojiListProps {
  host: string;
  emojis: EmojiItem[];
  loading: boolean;
  effectiveAccessToken: string | null;
  existingNames: Set<string>;
  refresh: () => Promise<void>;
}

export function EmojiList({
  host,
  emojis,
  loading,
  effectiveAccessToken,
  existingNames,
  refresh,
}: EmojiListProps) {
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [editingEmoji, setEditingEmoji] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingError, setEditingError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const base = getServerHttpBase(host);

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

  return (
    <Flex direction="column" gap="2">
      <Flex justify="between" align="center">
        <Text size="2" weight="medium">
          Custom emojis {!loading && `(${emojis.length})`}
        </Text>
        {emojis.length > 0 && (
          <AlertDialog.Root>
            <AlertDialog.Trigger>
              <Button size="xsmall" disabled={deletingAll}>
                <PiTrashFill size={14} />
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
                  <Button size="small">Cancel</Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action>
                  <Button size="small" onClick={handleDeleteAll}>
                    Delete all
                  </Button>
                </AlertDialog.Action>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        )}
      </Flex>

      {loading ? (
        <Text size="2">
          Loading...
        </Text>
      ) : emojis.length === 0 ? (
        <Text size="2">
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
                    <TextField size="small"
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
                    <IconButton tone="ghost" size="xsmall"
                      title="Save"
                      disabled={renaming}
                      onClick={handleRename}
                      style={{ cursor: "pointer", flexShrink: 0 }}
                    >
                      <PiCheck size={14} />
                    </IconButton>
                    <IconButton tone="ghost" size="xsmall"
                      title="Cancel"
                      disabled={renaming}
                      onClick={cancelEditing}
                      style={{ cursor: "pointer", flexShrink: 0 }}
                    >
                      <PiX size={14} />
                    </IconButton>
                  </Flex>
                  {editingError && (
                    <Text size="1" style={{ lineHeight: 1.2 }}>
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
                  <IconButton tone="ghost" size="xsmall"
                    onClick={() => startEditing(e.name)}
                    title={`Rename :${e.name}:`}
                    style={{ cursor: "pointer" }}
                  >
                    <PiPencilSimpleFill size={14} />
                  </IconButton>
                  <IconButton tone="ghost" size="xsmall"
                    onClick={() => handleDelete(e.name)}
                    disabled={deletingName === e.name}
                    title={`Delete :${e.name}:`}
                    style={{ cursor: "pointer" }}
                  >
                    <PiTrashFill size={14} />
                  </IconButton>
                </>
              )}
            </Flex>
          ))}
        </Flex>
      )}
    </Flex>
  );
}
