import { Button, Divider, IconButton } from "@gryt/ui";
import type { ReactNode } from "react";
import { Fragment, useEffect, useLayoutEffect, useRef } from "react";

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
  /**
   * The box you reply in, handed down for the same reason the rows are.
   *
   * It was a bare textarea, so there was no way to attach a file, no @mention
   * autocomplete, no emoji picker and nothing telling anybody you were typing.
   * The channel's ChatEditorBar does all of it and needs the member list, the
   * permission gates and the upload limits — all of which ChatView holds.
   */
  renderComposer: () => ReactNode;
  /** There is a page older than the first reply shown. */
  hasOlder?: boolean;
  /** One is already on its way. */
  loadingOlder?: boolean;
  /** Ask for it. Called when the list is scrolled near its top. */
  onLoadOlder?: () => void;
  /**
   * "Ridge is typing…", for this thread rather than for the channel.
   *
   * Handed down like the rows and the composer are. It used to be neither
   * drawn here nor filtered out of the channel's, so writing a reply put the
   * line under a timeline nobody was writing in (GRYT-1020).
   */
  typingIndicator?: ReactNode;
  onClose: () => void;
  onSetStatus?: (status: "open" | "solved" | "closed") => void;
  /** The channel's tag palette. Empty on a plain chat thread. */
  forumTags?: { id: string; name: string; emoji?: string | null; color?: string | null }[];
  onSetTags?: (tagIds: string[]) => void;
}

export function ThreadPanel({ thread, root, messages, loading, renderMessage, renderComposer, hasOlder, loadingOlder, onLoadOlder, typingIndicator, onClose, onSetStatus, forumTags = [], onSetTags }: ThreadPanelProps) {
  // Escape closes the panel. Without it the only way out is the ×, which sits
  // next to "Mark solved" — and a miss there changes the topic's state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
   * Hold the anchor across a prepend.
   *
   * Older replies go in above what is on screen, so the browser keeps the same
   * scrollTop and the content under the pointer jumps down by the height of
   * whatever arrived. Measured before the paint and corrected after, which is
   * what the channel's scroll hook does for the same reason.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const firstIdRef = useRef<string | null>(null);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !onLoadOlder || !hasOlder || loadingOlder) return;
    if (el.scrollTop > 120) return;
    anchorRef.current = el.scrollHeight - el.scrollTop;
    onLoadOlder();
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const firstId = messages[0]?.message_id ?? null;
    const grew = anchorRef.current !== null && firstId !== firstIdRef.current;
    firstIdRef.current = firstId;
    if (!el || !grew) return;
    el.scrollTop = el.scrollHeight - anchorRef.current!;
    anchorRef.current = null;
  }, [messages]);

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

      {/* Over the list rather than in it. Inside the scroller it added its own
          height while loading and took it away after, which moved the anchored
          content by exactly the banner — 32px of drift on a page that was
          otherwise held still. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {loadingOlder && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-1 py-2 text-center text-xs text-gryt-muted">
            Loading older replies…
          </div>
        )}
        <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
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
      </div>

      {/* The channel's own editor, so a reply can carry a file, name somebody
          and pick an emoji — and so the character limit, the permission gates
          and the upload cap are the ones the channel already enforces rather
          than a second copy of them. */}
      <div className="shrink-0 border-t border-gryt-border px-3.5 pt-2.5 pb-3.5">
        {typingIndicator}
        {renderComposer()}
      </div>
    </aside>
  );
}
