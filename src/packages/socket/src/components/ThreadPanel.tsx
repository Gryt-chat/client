import { Alert, Button, Composer, Divider, IconButton } from "@gryt/ui";
import type { ReactNode } from "react";
import { Fragment, useEffect, useState } from "react";

import { PiChatsFill, PiX } from "../../../../lib/icons";
import type { ChatMessage } from "./chatUtils";
import { EmojiText } from "./EmojiText";
import { ForumTagChip } from "./ForumTagChip";

interface ThreadSummary {
  thread_id: string;
  root_message_id: string;
  title: string | null;
  status: "open" | "solved" | "closed";
  reply_count: number;
  tags?: string[];
}

interface ThreadPanelProps {
  thread: ThreadSummary;
  root: ChatMessage | null;
  messages: ChatMessage[];
  loading: boolean;
  /**
   * Draws one message, handed down rather than done here.
   *
   * The panel used to own a thirty-line renderer that read four fields off a
   * message: a coloured letter for an avatar, the name, a clock time and the
   * text. No markdown, no attachments, no reactions, no mentions — a reply from
   * last week showed a bare time with no date anywhere. The channel's MessageRow
   * does all of it, and needs a dozen things ChatView already holds, so ChatView
   * builds the row and this renders where it goes. GRYT-1000.
   */
  renderMessage: (message: ChatMessage) => ReactNode;
  onClose: () => void;
  onSend: (text: string) => void;
  onSetStatus?: (status: "open" | "solved" | "closed") => void;
  /** The channel's tag palette. Empty on a plain chat thread. */
  forumTags?: { id: string; name: string; emoji?: string | null; color?: string | null }[];
  onSetTags?: (tagIds: string[]) => void;
}

export function ThreadPanel({ thread, root, messages, loading, renderMessage, onClose, onSend, onSetStatus, forumTags = [], onSetTags }: ThreadPanelProps) {
  const [draft, setDraft] = useState("");

  // Mirrors the server's cap, so an over-long reply is stopped here rather than
  // sent and refused.
  const REPLY_MAX = 4000;
  const tooLong = draft.length > REPLY_MAX;

  // Escape closes the panel. Without it the only way out is the ×, which sits
  // next to "Mark solved" — and a miss there changes the topic's state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = () => {
    const t = draft.trim();
    if (!t || tooLong) return;
    onSend(t);
    setDraft("");
  };

  return (
    <aside
      aria-label="Thread"
      style={{
        position: "absolute", top: 0, right: 0, bottom: 0,
        width: "min(380px, 100%)", zIndex: 20,
        display: "flex", flexDirection: "column",
        background: "var(--gryt-neutral-1)", borderLeft: "1px solid var(--gryt-neutral-6)",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.18)",
      }}
    >
      <header
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
          borderBottom: "1px solid var(--gryt-neutral-6)", flexShrink: 0,
        }}
      >
        <PiChatsFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--gryt-neutral-12)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.title ? <EmojiText text={thread.title} /> : "Thread"}
          </div>
          <div style={{ fontSize: 11, color: "var(--gryt-neutral-10)" }}>
            {thread.reply_count} {thread.reply_count === 1 ? "reply" : "replies"}
            {thread.status === "solved" && <span style={{ color: "var(--gryt-accent-11)", marginLeft: 8 }}>Solved</span>}
          </div>
        </div>
        {/* The old "Mark solved" was #5cc79a on a #5cc79a border — a green
            picked against the dark theme and left there for the light one.
            Marking something solved is an ordinary action, so it takes the
            accent; the solved *state* keeps the success tone on its chip. */}
        {onSetStatus && (thread.status === "solved" ? (
          <Button
            size="xsmall"
            tone="neutral"
            className="shrink-0 whitespace-nowrap"
            title="Reopen this topic"
            onClick={() => onSetStatus("open")}
          >
            Reopen
          </Button>
        ) : (
          <Button
            size="xsmall"
            className="shrink-0 whitespace-nowrap"
            title="Mark this topic solved"
            onClick={() => onSetStatus("solved")}
          >
            ✓ Mark solved
          </Button>
        ))}
        {onSetStatus && (
          <Divider orientation="vertical" className="my-1 self-stretch" />
        )}
        <IconButton size="xsmall" aria-label="Close thread" onClick={onClose}>
          <PiX size={16} />
        </IconButton>
      </header>

      {forumTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 14px", borderBottom: "1px solid var(--gryt-neutral-6)", flexShrink: 0 }}>
          {/* Without `onSetTags` these are labels rather than dead buttons —
              a disabled control still takes a tab stop and still announces
              itself as something you could press. */}
          {forumTags.map((tag) => {
            const on = (thread.tags ?? []).includes(tag.id);
            return (
              <ForumTagChip
                key={tag.id}
                tag={tag}
                active={on}
                onToggle={
                  onSetTags
                    ? () => {
                        const current = thread.tags ?? [];
                        onSetTags(
                          on
                            ? current.filter((id) => id !== tag.id)
                            : [...current, tag.id],
                        );
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {root && (
          <div className="mb-1 border-b border-gryt-border pb-1.5">
            {renderMessage(root)}
          </div>
        )}
        {loading ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--gryt-neutral-10)" }}>Loading…</div>
        ) : messages.length === 0 && root ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--gryt-neutral-10)" }}>No replies yet. Start the conversation.</div>
        ) : (
          messages.map((m) => (
            <Fragment key={m.message_id}>{renderMessage(m)}</Fragment>
          ))
        )}
      </div>

      <div style={{ padding: "10px 14px 14px", borderTop: "1px solid var(--gryt-neutral-6)", flexShrink: 0 }}>
        {tooLong && (
          <Alert severity="error" className="mb-1.5 px-2.5 py-1.5 text-xs">
            {draft.length - REPLY_MAX} characters over the {REPLY_MAX} limit.
          </Alert>
        )}
        {/* Composer already grows with the text and carries its own send
            button. Enter still sends and shift+enter still breaks the line —
            that is this handler, spread onto the textarea, not something
            Composer decides.

            No `disabled`: Composer puts it on the textarea as well as the
            button, so an empty draft would lock the box you type into and
            being over the limit would stop you deleting characters. `send`
            already refuses both, so the button is live and does nothing rather
            than looking dead. GRYT-998 is the prop that would fix it. */}
        <Composer
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          onSubmit={(e) => { e.preventDefault(); send(); }}
          placeholder="Reply to thread…"
          maxRows={5}
        />
      </div>
    </aside>
  );
}
