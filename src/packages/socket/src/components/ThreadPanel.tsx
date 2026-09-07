import { Alert, Button, Composer, Divider, IconButton } from "@gryt/ui";
import { useEffect, useState } from "react";

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

interface MemberLite {
  nickname?: string;
  avatar_file_id?: string;
}

interface ThreadPanelProps {
  thread: ThreadSummary;
  root: ChatMessage | null;
  messages: ChatMessage[];
  loading: boolean;
  memberList?: Record<string, MemberLite>;
  onClose: () => void;
  onSend: (text: string) => void;
  onSetStatus?: (status: "open" | "solved" | "closed") => void;
  /** The channel's tag palette. Empty on a plain chat thread. */
  forumTags?: { id: string; name: string; emoji?: string | null; color?: string | null }[];
  onSetTags?: (tagIds: string[]) => void;
}

function nameOf(m: ChatMessage, memberList?: Record<string, MemberLite>): string {
  return memberList?.[m.sender_server_id]?.nickname || m.sender_nickname || "Unknown";
}

function timeOf(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const AVATAR_HUES = ["#968ff8", "#e0a458", "#5cc79a", "#e06cae", "#7aa2f7", "#d98695"];
function hueFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

function ThreadMessage({ m, memberList }: { m: ChatMessage; memberList?: Record<string, MemberLite> }) {
  const name = nameOf(m, memberList);
  return (
    <div style={{ display: "flex", gap: "10px", padding: "8px 16px", opacity: m.pending ? 0.6 : 1 }}>
      <div
        aria-hidden="true"
        style={{
          width: 32, height: 32, borderRadius: "var(--gryt-radius-full)", flexShrink: 0,
          background: hueFor(m.sender_server_id), color: "var(--gryt-on-accent, #0c0a20)",
          display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13,
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--gryt-neutral-12)" }}>
            <EmojiText text={name} />
          </span>
          <span style={{ fontSize: 11, color: "var(--gryt-neutral-10)" }}>{timeOf(m.created_at)}</span>
        </div>
        <div style={{ fontSize: 14, color: "var(--gryt-neutral-11)", wordBreak: "break-word", marginTop: 2 }}>
          {m.text ? <EmojiText text={m.text} /> : <span style={{ fontStyle: "italic", opacity: 0.7 }}>No text</span>}
        </div>
        {m.failed && (
          <span style={{ fontSize: 11.5, color: "var(--gryt-danger-9)" }}>Failed to send</span>
        )}
      </div>
    </div>
  );
}

export function ThreadPanel({ thread, root, messages, loading, memberList, onClose, onSend, onSetStatus, forumTags = [], onSetTags }: ThreadPanelProps) {
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
          <div style={{ borderBottom: "1px solid var(--gryt-neutral-6)", paddingBottom: 6, marginBottom: 4 }}>
            <ThreadMessage m={root} memberList={memberList} />
          </div>
        )}
        {loading ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--gryt-neutral-10)" }}>Loading…</div>
        ) : messages.length === 0 && root ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--gryt-neutral-10)" }}>No replies yet. Start the conversation.</div>
        ) : (
          messages.map((m) => <ThreadMessage key={m.message_id} m={m} memberList={memberList} />)
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
