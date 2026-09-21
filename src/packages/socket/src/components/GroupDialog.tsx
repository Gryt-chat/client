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
import { uploadGroupPicture } from "../utils/uploadGroupPicture";
import { EmojiText } from "./EmojiText";
import type { MemberInfo } from "./MemberSidebar";

/**
 * A group's picture and name. Group settings shows them, and so does the step after
 * starting one in the new-message dialog; each decides when a change is sent.
 */
export function GroupFaceFields({
  serverHost,
  seed,
  icon,
  onIcon,
  name,
  onName,
  onNameDone,
  placeholder,
  autoFocus = false,
}: {
  serverHost: string;
  /** What the egg is drawn from, live, so it changes as the name is typed. */
  seed: string;
  /** The picture shown: an upload's file id, or null for the egg. */
  icon: string | null;
  onIcon: (fileId: string | null) => void;
  name: string;
  onName: (name: string) => void;
  /** Focus left the field, or Enter was pressed. */
  onNameDone?: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const token = getServerAccessToken(serverHost);
      if (!token) throw new Error("Not signed in to this server");
      onIcon(await uploadGroupPicture(getServerHttpBase(serverHost), token, file, file.name || "group.png"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload that");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex flex-col items-center gap-1">
        <Avatar
          size="large"
          className="h-20 w-20 rounded-(--gryt-radius-md) text-2xl"
          eggSeed={seed}
          src={icon ? getUploadsFileUrl(serverHost, icon, { thumb: true }) : undefined}
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

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="small"
            tone="ghost"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? "Uploading…" : "Choose a picture"}
          </Button>
          {icon && (
            <Button size="small" tone="ghost" onClick={() => onIcon(null)}>
              Use the egg
            </Button>
          )}
        </div>

        <span className="text-xs text-gryt-muted">
          {icon ? "Your picture" : "Drawn from the name"}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">Name</span>
        <TextField
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={name}
          onChange={(e) => onName(e.target.value)}
          onBlur={onNameDone}
          onKeyDown={(e) => {
            if (e.key === "Enter") onNameDone?.();
          }}
          maxLength={80}
        />
        <span className="text-xs text-gryt-muted">
          Leave it empty and the group is named after whoever is in it.
        </span>
      </div>
    </>
  );
}

/**
 * A group's settings. There is no owner: anybody in it can rename it, add somebody
 * or leave, and nobody can remove anybody else. Starting one is `NewMessageDialog`.
 */
export const GroupDialog = ({
  open,
  onOpenChange,
  members,
  serverHost,
  currentServerUserId,
  existing,
  canAdd,
  onUpdate,
  onAdd,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everybody on the server, to add from. */
  members: MemberInfo[];
  serverHost: string;
  currentServerUserId?: string;
  /** The group these are the settings of. Nothing opens without one. */
  existing?: DirectConversation;
  /** `create_groups`, which adding somebody asks for as well. */
  canAdd: boolean;
  onUpdate: (
    conversationId: string,
    changes: { name?: string | null; iconFileId?: string | null },
  ) => void;
  onAdd: (conversationId: string, targetServerUserId: string) => void;
  onLeave: (conversationId: string) => void;
}) => {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  /* `undefined` means "unchanged"; `null` means "go back to the drawn one".
     Two different answers, and a single string cannot carry both. */
  const [iconFileId, setIconFileId] = useState<string | null | undefined>(undefined);

  /* Reset every time it opens rather than on mount. The dialog outlives one
     use of it, so a name typed and cancelled would still be there next time. */
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? "");
    setPicked(existing ? existing.members.map((m) => m.server_user_id) : []);
    setIconFileId(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.conversation_id]);

  /** Everybody who could be added: not you, and not a bot, which the server refuses. */
  const candidates = useMemo(
    () =>
      members
        .filter((m) => m.serverUserId !== currentServerUserId && !m.isBot)
        .sort((a, b) => a.nickname.localeCompare(b.nickname)),
    [members, currentServerUserId],
  );

  const alreadyIn = useMemo(
    () => new Set(existing?.members.map((m) => m.server_user_id) ?? []),
    [existing],
  );

  if (!existing) return null;

  const toggle = (serverUserId: string) => {
    if (alreadyIn.has(serverUserId)) return;
    setPicked((prev) =>
      prev.includes(serverUserId)
        ? prev.filter((id) => id !== serverUserId)
        : [...prev, serverUserId],
    );
  };

  /** What the preview shows: just-uploaded, cleared, or whatever is stored. */
  const shownIcon = iconFileId === undefined ? (existing.icon_file_id ?? null) : iconFileId;

  const submit = () => {
    const trimmed = name.trim();
    const changes: { name?: string | null; iconFileId?: string | null } = {};
    if ((existing.name ?? "") !== trimmed) changes.name = trimmed || null;
    if (iconFileId !== undefined) changes.iconFileId = iconFileId;
    if (Object.keys(changes).length > 0) onUpdate(existing.conversation_id, changes);
    if (canAdd) {
      for (const id of picked) {
        if (!alreadyIn.has(id)) onAdd(existing.conversation_id, id);
      }
    }
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Group settings</Dialog.Title>
          <Dialog.Description>
            {canAdd
              ? "Anybody here can rename it or add people. Nobody can remove anybody else."
              : "Anybody here can rename it. Nobody can remove anybody else."}
          </Dialog.Description>

          <div className="flex flex-col gap-4">
            <GroupFaceFields
              serverHost={serverHost}
              seed={name.trim() || conversationTitle(existing)}
              icon={shownIcon}
              onIcon={setIconFileId}
              name={name}
              onName={setName}
              placeholder={conversationTitle(existing)}
              autoFocus
            />

            {canAdd && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-bold">Add people</span>
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
              </div>
            )}
          </div>

          <Dialog.Footer className="flex-wrap justify-between">
            <Button
              tone="danger"
              onClick={() => {
                onLeave(existing.conversation_id);
                onOpenChange(false);
              }}
            >
              Leave group
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button tone="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit}>Save</Button>
            </div>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
