import { Dialog, IconButton, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { PiChatCircleFill, PiChatsFill, PiRobotFill, PiSpeakerHighFill, PiX } from "../../../../lib/icons";

/** What the create form collects, mapped onto the channel's stored fields. */
export interface NewChannelOptions {
  name: string;
  type: "text" | "voice";
  layout?: "chat" | "forum";
  automated?: boolean;
  description?: string | null;
}

type ChannelKind = "chat" | "voice" | "forum" | "automated";

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: ChannelKind;
  editor: { createChannel: (opts: NewChannelOptions) => void | Promise<void> };
}

const KINDS: { key: ChannelKind; label: string; desc: string; Icon: typeof PiChatCircleFill }[] = [
  { key: "chat", label: "Chat", desc: "Normal real-time messages.", Icon: PiChatCircleFill },
  { key: "voice", label: "Voice", desc: "Talk and screen share.", Icon: PiSpeakerHighFill },
  { key: "forum", label: "Forum", desc: "Topics you can browse and solve.", Icon: PiChatsFill },
  { key: "automated", label: "Automated", desc: "Only bots and the system post.", Icon: PiRobotFill },
];

function toOptions(name: string, description: string, kind: ChannelKind): NewChannelOptions {
  const desc = description.trim() || null;
  switch (kind) {
    case "voice": return { name, type: "voice", description: desc };
    case "forum": return { name, type: "text", layout: "forum", description: desc };
    case "automated": return { name, type: "text", automated: true, description: desc };
    default: return { name, type: "text", layout: "chat", description: desc };
  }
}

export function CreateChannelDialog({ open, onOpenChange, initialType = "chat", editor }: CreateChannelDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<ChannelKind>(initialType);

  // Start fresh each time the dialog opens, honouring the type it was opened for.
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setKind(initialType);
    }
  }, [open, initialType]);

  const canCreate = name.trim().length > 0;

  const create = () => {
    if (!canCreate) return;
    editor.createChannel(toOptions(name.trim(), description, kind));
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {KINDS.map(({ key, label, desc, Icon }) => {
                  const selected = kind === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setKind(key)}
                      aria-pressed={selected}
                      style={{
                        display: "flex", gap: 11, alignItems: "flex-start", textAlign: "left",
                        padding: 12, borderRadius: "var(--gryt-radius-md)", cursor: "pointer",
                        background: selected ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                        border: `1px solid ${selected ? "var(--gryt-accent-9)" : "var(--gryt-neutral-6)"}`,
                      }}
                    >
                      <Icon size={22} style={{ color: "var(--gryt-accent-11)", flexShrink: 0, marginTop: 1 }} />
                      <span>
                        <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--gryt-neutral-12)" }}>{label}</span>
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--gryt-neutral-10)", marginTop: 2, lineHeight: 1.35 }}>{desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Description <span style={{ color: "var(--gryt-neutral-10)", fontWeight: 400 }}>(optional)</span></span>
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
