import { useEffect, useState } from "react";

import { PiChatsFill } from "../../../../lib/icons";
import type { ChatMessage } from "./chatUtils";
import { EmojiText } from "./EmojiText";

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
        {onSetStatus && (thread.status === "solved" ? (
          <button
            onClick={() => onSetStatus("open")}
            title="Reopen this topic"
            style={{ background: "none", border: "1px solid var(--gryt-neutral-6)", color: "var(--gryt-neutral-11)", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: "var(--gryt-radius-full)", whiteSpace: "nowrap" }}
          >
            Reopen
          </button>
        ) : (
          <button
            onClick={() => onSetStatus("solved")}
            title="Mark this topic solved"
            style={{ background: "none", border: "1px solid #5cc79a", color: "#5cc79a", cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: "var(--gryt-radius-full)", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            ✓ Mark solved
          </button>
        ))}
        {onSetStatus && (
          <span
            aria-hidden="true"
            style={{ width: 1, alignSelf: "stretch", margin: "4px 2px", background: "var(--gryt-neutral-6)" }}
          />
        )}
        <button
          onClick={onClose}
          aria-label="Close thread"
          style={{
            background: "none", border: "none", color: "var(--gryt-neutral-10)", cursor: "pointer",
            fontSize: 20, lineHeight: 1, padding: "2px 6px", borderRadius: "var(--gryt-radius-sm)",
          }}
        >
          ×
        </button>
      </header>

      {forumTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 14px", borderBottom: "1px solid var(--gryt-neutral-6)", flexShrink: 0 }}>
          {forumTags.map((tag) => {
            const on = (thread.tags ?? []).includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                disabled={!onSetTags}
                onClick={() => {
                  if (!onSetTags) return;
                  const current = thread.tags ?? [];
                  onSetTags(on ? current.filter((id) => id !== tag.id) : [...current, tag.id]);
                }}
                aria-pressed={on}
                title={on ? `Remove ${tag.name}` : `Add ${tag.name}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600,
                  padding: "3px 10px", borderRadius: "var(--gryt-radius-full)",
                  cursor: onSetTags ? "pointer" : "default",
                  background: on ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                  color: on ? "var(--gryt-accent-11)" : "var(--gryt-neutral-10)",
                  border: `1px solid ${on ? "transparent" : "var(--gryt-neutral-6)"}`,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 2, background: tag.color || "var(--gryt-accent-9)" }} />
                {tag.emoji ? `${tag.emoji} ` : ""}{tag.name}
              </button>
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
          <div role="alert" style={{ fontSize: 11.5, color: "var(--gryt-danger-9)", marginBottom: 6 }}>
            {draft.length - REPLY_MAX} characters over the {REPLY_MAX} limit.
          </div>
        )}
        <div
          style={{
            display: "flex", alignItems: "flex-end", gap: 8,
            background: "var(--gryt-neutral-3)", border: "1px solid var(--gryt-neutral-6)",
            borderRadius: "var(--gryt-radius-md)", padding: "8px 10px",
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Reply to thread…"
            rows={1}
            style={{
              flex: 1, resize: "none", background: "transparent", border: "none", outline: "none",
              color: "var(--gryt-neutral-12)", fontSize: 14, fontFamily: "inherit", maxHeight: 120,
            }}
          />
          <button
            onClick={send}
            disabled={!draft.trim() || tooLong}
            style={{
              background: draft.trim() && !tooLong ? "var(--gryt-accent-9)" : "var(--gryt-neutral-6)",
              color: draft.trim() && !tooLong ? "var(--gryt-on-accent, #0c0a20)" : "var(--gryt-neutral-10)",
              border: "none", borderRadius: "var(--gryt-radius-sm)", padding: "6px 12px",
              fontWeight: 700, fontSize: 13, cursor: draft.trim() && !tooLong ? "pointer" : "default",
            }}
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}
