import { Alert, Button, Chip, Dialog, IconButton, TextField, Toggle, ToggleGroup } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";

import { useThreadMentions, useThreadUnread } from "@/common";
import type { ForumTag } from "@/settings/src/types/server";

import { PiChatsFill, PiPlus, PiX } from "../../../../lib/icons";
import { type ForumFilter, type ForumTopic,useForum } from "../hooks/useForum";
import type { ThreadSummary } from "../hooks/useThreads";
import { EmojiText } from "./EmojiText";
import { ForumTagChip } from "./ForumTagChip";
import { UnreadIndicator } from "./UnreadIndicator";

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
  const { threadUnreadCount } = useThreadUnread();
  const { threadMentionCount } = useThreadMentions();
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
      <div className="flex flex-wrap items-center gap-2.5 border-b border-gryt-border pb-3">
        {/* Base UI hands back an array and clears it when the pressed one is
            pressed again. There is always a filter, so an empty answer means
            "no change" rather than "none". */}
        <ToggleGroup
          value={[filter]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked) setFilter(picked as ForumFilter);
          }}
          multiple={false}
        >
          {FILTERS.map((f) => (
            <Toggle key={f.key} value={f.key} tone="neutral" size="xsmall">
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[f.key]}</span>
            </Toggle>
          ))}
        </ToggleGroup>
        <span className="flex-1" />
        <Button
          size="small"
          startIcon={<PiPlus size={14} />}
          onClick={() => { setNewTags(new Set()); setComposing(true); }}
        >
          New topic
        </Button>
      </div>

      {forumTags.length > 0 && (
        <div className="flex flex-wrap gap-[7px] border-b border-gryt-neutral-3 pt-2.5 pb-3">
          {forumTags.map((tag) => (
            <ForumTagChip
              key={tag.id}
              tag={tag}
              active={selectedTags.has(tag.id)}
              onToggle={() => setSelectedTags((s) => toggle(s, tag.id))}
            />
          ))}
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
              /* Hover through CSS rather than writing to style on every pointer
                 event, which left the row stuck on a re-render. */
              className="hover:bg-gryt-neutral-3"
            >
              <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--gryt-neutral-12)", gridColumn: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <EmojiText text={t.title || t.preview || "Untitled topic"} />
              </div>
              {t.tags.length > 0 && (
                <div style={{ gridColumn: 1 }} className="flex flex-wrap items-center gap-1.5">
                  {t.tags.map((id) => {
                    const tag = tagById.get(id);
                    return tag ? <ForumTagChip key={id} tag={tag} /> : null;
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
              {/* Replies since this window connected. Sits with the solved
                  chip on the right, so the row reads title, tags, who and when
                  on the left and its state on the right. */}
              <div style={{ gridRow: "1 / 3", gridColumn: 2 }} className="flex items-center gap-2 self-center">
              <UnreadIndicator
                unread={threadUnreadCount(serverHost ?? "", t.thread_id)}
                mentions={threadMentionCount(serverHost ?? "", t.thread_id)}
              />
              {t.status === "solved" && (
                /* The success tone, rather than the #5cc79a it hardcoded — that
                   green was picked against the dark theme. */
                <Chip
                  tone="success"
                  label="✓ Solved"
                  className="px-2.5 py-0.5 text-[11px] whitespace-nowrap"
                />
              )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* New topic dialog. A real one: it was a scrim div with a
          click-outside check on e.target, so it had no focus trap, nothing on
          escape, and it rendered inside the forum's own stacking context. */}
      <Dialog.Root
        open={composing}
        onOpenChange={(open) => {
          if (!open) clearCreateError();
          setComposing(open);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Dialog.Title style={{ margin: 0 }}>New topic</Dialog.Title>
                <Dialog.Close>
                  <IconButton size="xsmall"><PiX size={16} /></IconButton>
                </Dialog.Close>
              </div>

              <TextField
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title"
                autoFocus
                maxLength={200}
              />
              <TextField
                multiline
                minRows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe what&rsquo;s happening…"
              />

              {forumTags.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Tags</span>
                  <div className="flex flex-wrap gap-[7px]">
                    {forumTags.map((tag) => (
                      <ForumTagChip
                        key={tag.id}
                        tag={tag}
                        active={newTags.has(tag.id)}
                        onToggle={() => setNewTags((s) => toggle(s, tag.id))}
                      />
                    ))}
                  </div>
                </div>
              )}

              {(createError || tooLong) && (
                <Alert severity="error" className="text-xs">
                  {tooLong
                    ? `That message is ${body.length - BODY_MAX} characters over the ${BODY_MAX} limit.`
                    : createError}
                </Alert>
              )}

              <div className="flex justify-end gap-3">
                <Dialog.Close>
                  <Button tone="neutral" size="small">Cancel</Button>
                </Dialog.Close>
                <Button size="small" onClick={submit} disabled={!canSubmit}>
                  {creating ? "Creating…" : "Create topic"}
                </Button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
