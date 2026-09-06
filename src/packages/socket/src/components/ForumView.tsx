import { useEffect, useMemo, useState } from "react";

import type { ForumTag } from "@/settings/src/types/server";

import { PiChatsFill } from "../../../../lib/icons";
import { type ForumFilter, type ForumTopic,useForum } from "../hooks/useForum";
import type { ThreadSummary } from "../hooks/useThreads";
import { EmojiText } from "./EmojiText";

interface ForumViewProps {
  socketConnection: unknown;
  conversationId: string;
  serverHost?: string;
  currentUserId?: string;
  forumTags: ForumTag[];
  onOpenTopic: (summary: ThreadSummary) => void;
}

const FILTERS: { key: ForumFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unanswered", label: "Unanswered" },
  { key: "solved", label: "Solved" },
  { key: "mine", label: "Mine" },
];

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function toSummary(t: ForumTopic): ThreadSummary {
  return {
    thread_id: t.thread_id,
    conversation_id: t.conversation_id,
    root_message_id: t.root_message_id,
    title: t.title,
    status: t.status,
    reply_count: t.reply_count,
    last_message_at: t.last_message_at,
    tags: t.tags,
  };
}

function matchesFilter(t: ForumTopic, filter: ForumFilter, currentUserId?: string): boolean {
  switch (filter) {
    // A solved topic is answered even with no replies — the author settled it.
    case "unanswered": return t.reply_count === 0 && t.status === "open";
    case "solved": return t.status === "solved";
    case "mine": return !!currentUserId && t.creator_server_id === currentUserId;
    default: return t.status !== "closed";
  }
}

export function ForumView({ socketConnection, conversationId, serverHost, currentUserId, forumTags, onOpenTopic }: ForumViewProps) {
  const { topics, loading, creating, createError, createdToken, clearCreateError, createTopic } = useForum(socketConnection, conversationId, serverHost);
  const [filter, setFilter] = useState<ForumFilter>("all");
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [newTags, setNewTags] = useState<Set<string>>(new Set());
  const tagById = useMemo(() => new Map(forumTags.map((t) => [t.id, t])), [forumTags]);
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const shown = useMemo(
    () => topics.filter((t) =>
      matchesFilter(t, filter, currentUserId) &&
      (selectedTags.size === 0 || t.tags.some((id) => selectedTags.has(id)))),
    [topics, filter, currentUserId, selectedTags],
  );

  const counts = useMemo(() => ({
    all: topics.filter((t) => t.status !== "closed").length,
    unanswered: topics.filter((t) => t.reply_count === 0 && t.status === "open").length,
    solved: topics.filter((t) => t.status === "solved").length,
    mine: topics.filter((t) => !!currentUserId && t.creator_server_id === currentUserId).length,
  }), [topics, currentUserId]);

  // Mirrors the server's cap so an over-long post is caught before a round trip.
  const BODY_MAX = 4000;
  const tooLong = body.length > BODY_MAX;
  const canSubmit = !!title.trim() && !!body.trim() && !tooLong && !creating;

  const submit = () => {
    if (!canSubmit) return;
    // Nothing is cleared or closed here. The composer closes when the server
    // accepts the topic (createdToken), so a refusal keeps what was typed.
    createTopic(title, body, [...newTags]);
  };

  useEffect(() => {
    if (createdToken === 0) return;
    setTitle("");
    setBody("");
    setNewTags(new Set());
    setComposing(false);
  }, [createdToken]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* Filter bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", paddingBottom: 12, borderBottom: "1px solid var(--gryt-neutral-6)" }}>
        <div style={{ display: "flex", gap: 2, background: "var(--gryt-neutral-3)", border: "1px solid var(--gryt-neutral-6)", borderRadius: "var(--gryt-radius-full)", padding: 3 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              style={{
                background: filter === f.key ? "var(--gryt-neutral-4)" : "transparent",
                color: filter === f.key ? "var(--gryt-neutral-12)" : "var(--gryt-neutral-10)",
                border: "none", borderRadius: "var(--gryt-radius-full)", padding: "5px 12px",
                fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              {f.label}
              <span style={{ color: "var(--gryt-neutral-9)", marginLeft: 5, fontVariantNumeric: "tabular-nums" }}>
                {counts[f.key]}
              </span>
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => { setNewTags(new Set()); setComposing(true); }}
          style={{
            background: "var(--gryt-accent-9)", color: "var(--gryt-on-accent, #0c0a20)", border: "none",
            fontWeight: 700, fontSize: 13, padding: "8px 15px", borderRadius: "var(--gryt-radius-full)",
            display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New topic
        </button>
      </div>

      {forumTags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, padding: "10px 0 12px", borderBottom: "1px solid var(--gryt-neutral-3)" }}>
          {forumTags.map((tag) => {
            const active = selectedTags.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => setSelectedTags((s) => toggle(s, tag.id))}
                aria-pressed={active}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600,
                  padding: "3px 10px", borderRadius: "var(--gryt-radius-full)", cursor: "pointer",
                  background: active ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                  color: active ? "var(--gryt-accent-11)" : "var(--gryt-neutral-11)",
                  border: `1px solid ${active ? "transparent" : "var(--gryt-neutral-6)"}`,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 2, background: tag.color || "var(--gryt-accent-9)" }} />
                {tag.emoji ? `${tag.emoji} ` : ""}{tag.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Topic list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, color: "var(--gryt-neutral-10)", fontSize: 13 }}>Loading topics…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--gryt-neutral-10)" }}>
            <PiChatsFill size={28} style={{ opacity: 0.5 }} />
            <p style={{ marginTop: 8, fontSize: 14 }}>
              {topics.length === 0 ? "No topics yet. Start the first one." : "Nothing matches this filter."}
            </p>
          </div>
        ) : (
          shown.map((t) => (
            <button
              key={t.thread_id}
              onClick={() => onOpenTopic(toSummary(t))}
              style={{
                display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", alignItems: "center", width: "100%",
                textAlign: "left", background: "transparent", border: "none",
                borderBottom: "1px solid var(--gryt-neutral-3)", padding: "11px 4px", cursor: "pointer",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--gryt-neutral-12)", gridColumn: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <EmojiText text={t.title || t.preview || "Untitled topic"} />
              </div>
              {t.tags.length > 0 && (
                <div style={{ gridColumn: 1, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {t.tags.map((id) => {
                    const tag = tagById.get(id);
                    if (!tag) return null;
                    return (
                      <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--gryt-radius-full)", background: "var(--gryt-neutral-3)", color: "var(--gryt-neutral-11)", border: "1px solid var(--gryt-neutral-6)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: tag.color || "var(--gryt-accent-9)" }} />
                        {tag.emoji ? `${tag.emoji} ` : ""}{tag.name}
                      </span>
                    );
                  })}
                </div>
              )}
              <div style={{ gridColumn: 1, color: "var(--gryt-neutral-10)", fontSize: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span>{t.creator_nickname || "Someone"}</span>
                <span>·</span>
                <span>{t.reply_count} {t.reply_count === 1 ? "reply" : "replies"}</span>
                <span>·</span>
                <span>{t.participant_count} {t.participant_count === 1 ? "participant" : "participants"}</span>
                <span>·</span>
                <span>{relativeTime(t.last_message_at)}</span>
              </div>
              {t.status === "solved" && (
                <span style={{
                  gridRow: "1 / 3", gridColumn: 2, alignSelf: "center",
                  fontSize: 11, fontWeight: 700, color: "#5cc79a", background: "rgba(92,199,154,0.12)",
                  padding: "3px 9px", borderRadius: "var(--gryt-radius-full)", whiteSpace: "nowrap",
                }}>
                  ✓ Solved
                </span>
              )}
            </button>
          ))
        )}
      </div>

      {/* New topic dialog */}
      {composing && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setComposing(false); }}
          style={{ position: "absolute", inset: 0, background: "rgba(6,7,10,0.55)", display: "grid", placeItems: "center", padding: 16, zIndex: 30 }}
        >
          <div style={{ width: "min(520px, 100%)", background: "var(--gryt-neutral-2, var(--gryt-neutral-1))", border: "1px solid var(--gryt-neutral-6)", borderRadius: "var(--gryt-radius-lg)", overflow: "hidden" }}>
            <div style={{ padding: "16px 18px 4px", fontSize: 16, fontWeight: 700, color: "var(--gryt-neutral-12)" }}>New topic</div>
            <div style={{ padding: "12px 18px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                autoFocus
                maxLength={200}
                style={{ background: "var(--gryt-neutral-3)", border: "1px solid var(--gryt-neutral-6)", borderRadius: "var(--gryt-radius-sm)", padding: "10px 12px", color: "var(--gryt-neutral-12)", fontSize: 14, fontFamily: "inherit", outline: "none" }}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe what's happening…"
                rows={5}
                style={{ background: "var(--gryt-neutral-3)", border: "1px solid var(--gryt-neutral-6)", borderRadius: "var(--gryt-radius-sm)", padding: "10px 12px", color: "var(--gryt-neutral-12)", fontSize: 14, fontFamily: "inherit", resize: "vertical", outline: "none" }}
              />
              {forumTags.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="text-sm font-medium">Tags</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {forumTags.map((tag) => {
                      const active = newTags.has(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => setNewTags((s) => toggle(s, tag.id))}
                          aria-pressed={active}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600,
                            padding: "4px 10px", borderRadius: "var(--gryt-radius-full)", cursor: "pointer",
                            background: active ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                            color: active ? "var(--gryt-accent-11)" : "var(--gryt-neutral-11)",
                            border: `1px solid ${active ? "transparent" : "var(--gryt-neutral-6)"}`,
                          }}
                        >
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: tag.color || "var(--gryt-accent-9)" }} />
                          {tag.emoji ? `${tag.emoji} ` : ""}{tag.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {(createError || tooLong) && (
                <div
                  role="alert"
                  style={{ fontSize: 12.5, color: "var(--gryt-danger-9)", background: "var(--gryt-danger-2, rgba(248,113,113,0.12))", border: "1px solid var(--gryt-danger-9)", borderRadius: "var(--gryt-radius-sm)", padding: "8px 10px" }}
                >
                  {tooLong
                    ? `That message is ${body.length - BODY_MAX} characters over the ${BODY_MAX} limit.`
                    : createError}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  onClick={() => { clearCreateError(); setComposing(false); }}
                  style={{ background: "var(--gryt-neutral-4)", color: "var(--gryt-neutral-12)", border: "1px solid var(--gryt-neutral-6)", fontWeight: 600, fontSize: 13, padding: "8px 14px", borderRadius: "var(--gryt-radius-full)", cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  style={{
                    background: canSubmit ? "var(--gryt-accent-9)" : "var(--gryt-neutral-6)",
                    color: canSubmit ? "var(--gryt-on-accent, #0c0a20)" : "var(--gryt-neutral-10)",
                    border: "none", fontWeight: 700, fontSize: 13, padding: "8px 15px", borderRadius: "var(--gryt-radius-full)",
                    cursor: canSubmit ? "pointer" : "default",
                  }}
                >
                  {creating ? "Creating…" : "Create topic"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
