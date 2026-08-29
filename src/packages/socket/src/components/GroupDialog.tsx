import { Avatar, Button, Checkbox, Dialog, TextField } from "@gryt/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  getServerAccessToken,
  getServerHttpBase,
  getUploadsFileUrl,
  resolveAvatarSrc,
} from "@/common";

import { conversationTitle, type DirectConversation } from "../hooks/useDirectMessages";
import { EmojiText } from "./EmojiText";
import type { MemberInfo } from "./MemberSidebar";

/**
 * Starting a group, and managing one.
 *
 * The same dialog for both, because they ask the same questions — what is it
 * called, who is in it — and a separate "edit" screen would be the same fields
 * with a different verb on the button.
 *
 * There is no owner. Anybody in a group can rename it, add somebody, or leave;
 * nobody can remove anybody else. A conversation with no moderators does not
 * need a moderation model, and not having one is a decision that needs no
 * further decisions later.
 */
export const GroupDialog = ({
  open,
  onOpenChange,
  members,
  serverHost,
  currentServerUserId,
  existing,
  initialMemberIds = [],
  onCreate,
  onUpdate,
  onAdd,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everybody on the server, to pick from. */
  members: MemberInfo[];
  serverHost: string;
  currentServerUserId?: string;
  /** Managing this one, or starting a new one when absent. */
  existing?: DirectConversation;
  /** Ticked to begin with — the person whose DM this was started from. */
  initialMemberIds?: string[];
  onCreate: (memberIds: string[], name?: string, iconFileId?: string | null) => void;
  onUpdate: (
    conversationId: string,
    changes: { name?: string | null; iconFileId?: string | null },
  ) => void;
  onAdd: (conversationId: string, targetServerUserId: string) => void;
  onLeave: (conversationId: string) => void;
}) => {
  const managing = !!existing;

  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  /* `undefined` means "unchanged"; `null` means "go back to the drawn one".
     Two different answers, and a single string cannot carry both. */
  const [iconFileId, setIconFileId] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /* Reset every time it opens rather than on mount. The dialog outlives one
     use of it, so a name typed and cancelled would still be there next time. */
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setPicked(existing ? existing.members.map((m) => m.server_user_id) : initialMemberIds);
    setIconFileId(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.conversation_id]);

  /** Everybody who could be added — not you, and not a bot. */
  const candidates = useMemo(
    () =>
      members
        .filter((m) => m.serverUserId !== currentServerUserId)
        .sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [members, currentServerUserId],
  );

  const alreadyIn = useMemo(
    () => new Set(existing?.members.map((m) => m.server_user_id) ?? []),
    [existing],
  );

  /* What the icon is drawn from, live. Seeded on the name so it changes as you
     type, which is the whole reason the picture is not something you pick. */
  const previewSeed =
    name.trim() ||
    (existing ? conversationTitle(existing) : "") ||
    candidates
      .filter((m) => picked.includes(m.serverUserId))
      .map((m) => m.nickname)
      .join(", ") ||
    "New group";

  const enoughPeople = managing || picked.length >= 2;

  const toggle = (serverUserId: string) => {
    if (alreadyIn.has(serverUserId)) return;
    setPicked((prev) =>
      prev.includes(serverUserId)
        ? prev.filter((id) => id !== serverUserId)
        : [...prev, serverUserId],
    );
  };

  /** What the preview shows: just-uploaded, cleared, or whatever is stored. */
  const shownIcon = iconFileId === undefined ? (existing?.icon_file_id ?? null) : iconFileId;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const token = getServerAccessToken(serverHost);
      if (!token) throw new Error("Not signed in to this server");
      const form = new FormData();
      form.append("file", file, file.name || "group.png");
      /* The avatar endpoint, because a group picture is the same job: one
         square image, resized and thumbnailed by the same worker. A second
         endpoint doing that again is a second place for the limits to drift. */
      const response = await fetch(`${getServerHttpBase(serverHost)}/api/uploads/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as {
        avatarFileId?: string;
        message?: string;
      };
      if (!response.ok || !data.avatarFileId) {
        throw new Error(data.message || "The server would not take that picture");
      }
      setIconFileId(data.avatarFileId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that");
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    if (managing && existing) {
      const trimmed = name.trim();
      const changes: { name?: string | null; iconFileId?: string | null } = {};
      if ((existing.name ?? "") !== trimmed) changes.name = trimmed || null;
      if (iconFileId !== undefined) changes.iconFileId = iconFileId;
      if (Object.keys(changes).length > 0) onUpdate(existing.conversation_id, changes);
      for (const id of picked) {
        if (!alreadyIn.has(id)) onAdd(existing.conversation_id, id);
      }
    } else {
      if (!enoughPeople) return;
      onCreate(picked, name.trim() || undefined, iconFileId ?? undefined);
    }
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>{managing ? "Group settings" : "New group"}</Dialog.Title>
          <Dialog.Description>
            {managing
              ? "Anybody here can rename it or add people. Nobody can remove anybody else."
              : "The conversation you already had with them stays where it is."}
          </Dialog.Description>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-1">
              <Avatar
                size="large"
                className="h-20 w-20 rounded-(--gryt-radius-md) text-2xl"
                eggSeed={previewSeed}
                src={shownIcon ? getUploadsFileUrl(serverHost, shownIcon, { thumb: true }) : undefined}
              />

              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />

              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  tone="ghost"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? "Uploading…" : "Choose a picture"}
                </Button>
                {shownIcon && (
                  <Button size="small" tone="ghost" onClick={() => setIconFileId(null)}>
                    Use the egg
                  </Button>
                )}
              </div>

              <span className="text-xs text-gryt-muted">
                {shownIcon ? "Your picture" : "Drawn from the name"}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold">Name</span>
              <TextField
                autoFocus
                placeholder={managing ? conversationTitle(existing) : "Optional"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
              <span className="text-xs text-gryt-muted">
                Leave it empty and the group is named after whoever is in it.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold">
                {managing ? "Add people" : `People — ${picked.length} picked`}
              </span>
              <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                {candidates.map((member) => {
                  const inAlready = alreadyIn.has(member.serverUserId);
                  return (
                    <label
                      key={member.serverUserId}
                      className="flex cursor-pointer items-center gap-2 rounded-(--gryt-radius-md) px-2 py-1 hover:bg-gryt-surface-raised"
                    >
                      <Checkbox
                        checked={inAlready || picked.includes(member.serverUserId)}
                        disabled={inAlready}
                        onCheckedChange={() => toggle(member.serverUserId)}
                      />
                      <Avatar
                        size="small"
                        fallback={member.nickname[0]}
                        src={resolveAvatarSrc(
                          member.avatarFileId
                            ? getUploadsFileUrl(serverHost, member.avatarFileId, { thumb: true })
                            : undefined,
                          member.nickname,
                          member.avatarWorn,
                        )}
                      />
                      <span className="truncate text-sm">
                        <EmojiText text={member.nickname} />
                      </span>
                      {inAlready && (
                        <span className="ml-auto text-xs text-gryt-muted">Already in</span>
                      )}
                    </label>
                  );
                })}
              </div>
              {!managing && !enoughPeople && (
                <span className="text-xs text-gryt-muted">
                  Pick at least two people. Two of you is a direct message, which you already have.
                </span>
              )}
            </div>
          </div>

          <Dialog.Footer className="justify-between">
            {managing && existing ? (
              <Button
                tone="danger"
                onClick={() => {
                  onLeave(existing.conversation_id);
                  onOpenChange(false);
                }}
              >
                Leave group
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button tone="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={!enoughPeople}>
                {managing ? "Save" : "Create group"}
              </Button>
            </div>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
