import { Dialog, IconButton, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { PiX } from "../../../../lib/icons";
import { type ChannelKind, kindToFields } from "./channelKind";
import { ChannelKindPicker } from "./ChannelKindPicker";
import { type ForumTagDraft, ForumTagsField } from "./ForumTagsField";

/** What the create form collects, mapped onto the channel's stored fields. */
export interface NewChannelOptions {
  name: string;
  type: "text" | "voice";
  layout?: "chat" | "forum";
  automated?: boolean;
  description?: string | null;
  forumTags?: ForumTagDraft[];
}

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: ChannelKind;
  editor: { createChannel: (opts: NewChannelOptions) => void | Promise<void> };
}

export function CreateChannelDialog({ open, onOpenChange, initialType = "chat", editor }: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ChannelKind>(initialType);
  const [tags, setTags] = useState<ForumTagDraft[]>([]);

  // Start fresh each time the dialog opens, honouring the type it was opened for.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setKind(initialType);
      setTags([]);
    }
  }, [open, initialType]);

  const canCreate = name.trim().length > 0;

  const create = () => {
    if (!canCreate) return;
    const fields = kindToFields(kind);
    editor.createChannel({
      name: name.trim(),
      type: fields.type,
      layout: fields.layout,
      automated: fields.automated,
      description: description.trim() || null,
      forumTags: kind === "forum" ? tags : [],
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Dialog.Title style={{ margin: 0 }}>Create channel</Dialog.Title>
              <Dialog.Close>
                <IconButton size="xsmall"><PiX size={16} /></IconButton>
              </Dialog.Close>
            </div>

            <span className="text-sm" style={{ color: "var(--gryt-neutral-11)", marginTop: -8 }}>
              Set it up here &mdash; the channel is created only when you hit Create.
            </span>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Channel name</span>
              <TextField
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
                placeholder={kind === "voice" ? "voice-chat" : "support"}
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Channel type</span>
              <ChannelKindPicker value={kind} onChange={setKind} />
            </div>

            {kind === "forum" && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">
                  Tags <span style={{ color: "var(--gryt-neutral-10)", fontWeight: 400 }}>(optional)</span>
                </span>
                <ForumTagsField tags={tags} onChange={setTags} />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Description <span style={{ color: "var(--gryt-neutral-10)", fontWeight: 400 }}>(optional)</span>
              </span>
              <TextField
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
                placeholder="What's this channel for?"
              />
            </div>

            <div className="flex justify-end gap-3" style={{ marginTop: 4 }}>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                style={{ background: "var(--gryt-neutral-4)", color: "var(--gryt-neutral-12)", border: "1px solid var(--gryt-neutral-6)", fontWeight: 600, fontSize: 13, padding: "8px 14px", borderRadius: "var(--gryt-radius-full)", cursor: "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={create}
                disabled={!canCreate}
                style={{
                  background: canCreate ? "var(--gryt-accent-9)" : "var(--gryt-neutral-6)",
                  color: canCreate ? "var(--gryt-on-accent, #0c0a20)" : "var(--gryt-neutral-10)",
                  border: "none", fontWeight: 700, fontSize: 13, padding: "8px 16px", borderRadius: "var(--gryt-radius-full)",
                  cursor: canCreate ? "pointer" : "default",
                }}
              >
                Create channel
              </button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
