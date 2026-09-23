import { Button, Divider, IconButton, Tooltip } from "@gryt/ui";
import type { ReactNode } from "react";
import { Fragment, useEffect, useLayoutEffect, useRef } from "react";

import { PiCaretLeftBold, PiChatsFill, PiCheck, PiX } from "../../../../lib/icons";
import { THREAD_PANEL_WIDTH } from "../lib/narrowLayout";
import type { ChatMessage } from "./chatUtils";
import { EmojiText } from "./EmojiText";
import { ForumTagChip } from "./ForumTagChip";

interface ThreadSummary {
  thread_id: string;
  root_message_id: string;
  title: string | null;
  status: "open" | "solved" | "closed";
  reply_count: number;
  /** Locked to new replies, the way closed is. chat:send refuses both. */
  locked?: boolean;
  tags?: string[];
}

interface ThreadPanelProps {
  thread: ThreadSummary;
  root: ChatMessage | null;
  messages: ChatMessage[];
  loading: boolean;
  /**
   * Draws one message, handed down rather than done here. The channel's
   * MessageRow needs a dozen things ChatView already holds (GRYT-1000).
   */
  renderMessage: (message: ChatMessage) => ReactNode;
  /**
   * The box you reply in, handed down for the same reason the rows are. It was a
   * bare textarea: no attachments, no mentions, no emoji picker, no typing.
   */
  renderComposer: () => ReactNode;
  /** There is a page older than the first reply shown. */
  hasOlder?: boolean;
  /** One is already on its way. */
  loadingOlder?: boolean;
  /** Why the replies are not here. Drawn in their place, with Try again. */
  error?: string | null;
  onRetry?: () => void;
  /** Ask for it. Called when the list is scrolled near its top. */
  onLoadOlder?: () => void;
  /**
   * "Ridge is typing…", for this thread rather than the channel. It used to be
   * neither drawn here nor filtered out of the channel's (GRYT-1020).
   */
  typingIndicator?: ReactNode;
  onClose: () => void;
  onSetStatus?: (status: "open" | "solved" | "closed") => void;
  /** The channel's tag palette. Empty on a plain chat thread. */
  forumTags?: { id: string; name: string; emoji?: string | null; color?: string | null }[];
  onSetTags?: (tagIds: string[]) => void;
  /**
   * Whether the window is wide enough to put this beside the conversation. It
   * takes the whole chat pane otherwise, rather than covering half a message row.
   */
  beside?: boolean;
}

export function ThreadPanel({ thread, root, messages, loading, renderMessage, renderComposer, hasOlder, loadingOlder, onLoadOlder, typingIndicator, onClose, onSetStatus, forumTags = [], onSetTags, error, onRetry, beside = false }: ThreadPanelProps) {
  /* What chat:send checks before it takes a reply. Drawing a composer the
     server will refuse is what GRYT-1389 was about. */
  const takesReplies = thread.status !== "closed" && thread.locked !== true;

  /* Escape closes the panel, but only when nothing inside it took the key
     first: an autocomplete or an edit being called off used to close it too. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
   * Hold the anchor across a prepend: older replies go in above, so the browser
   * keeps scrollTop and the content under the pointer jumps down.
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const firstIdRef = useRef<string | null>(null);
  /* Whether the newest reply should stay in view. True on open, and again
     whenever the list is scrolled back down to the bottom. */
  const pinnedRef = useRef(true);

  useEffect(() => {
    pinnedRef.current = true;
  }, [thread.thread_id]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!onLoadOlder || !hasOlder || loadingOlder) return;
    if (el.scrollTop > 120) return;
    anchorRef.current = el.scrollHeight - el.scrollTop;
    onLoadOlder();
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const firstId = messages[0]?.message_id ?? null;
    const grew = anchorRef.current !== null && firstId !== firstIdRef.current;
    firstIdRef.current = firstId;
    if (!el) return;
    if (grew) {
      el.scrollTop = el.scrollHeight - anchorRef.current!;
      anchorRef.current = null;
      return;
    }
    // A thread with 54 replies opened 2585px above the newest one, which a
    // channel never does.
    if (pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, root, loading]);

  return (
    <aside
      aria-label="Thread"
      data-beside={beside ? "yes" : "no"}
      style={{
        /* Beside: a column in the row, so the conversation keeps the width it is
           drawn at. Otherwise the whole pane, so nothing is left half covered. */
        ...(beside
          ? { position: "relative", width: THREAD_PANEL_WIDTH, flexShrink: 0, borderLeft: "1px solid var(--gryt-neutral-6)" }
          : { position: "absolute", inset: 0, zIndex: 20 }),
        display: "flex", flexDirection: "column", minWidth: 0,
        background: "var(--gryt-neutral-1)",
      }}
    >
      <header
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "12px 14px",
          borderBottom: "1px solid var(--gryt-neutral-6)", flexShrink: 0,
        }}
      >
        {/* Taking the pane leaves nothing else on screen, so the icon gives way
            to the way back. */}
        {beside ? (
          <PiChatsFill size={18} style={{ color: "var(--gryt-neutral-11)", flexShrink: 0 }} />
        ) : (
          <Tooltip title="Back to the conversation">
            <IconButton size="xsmall" tone="ghost" aria-label="Back to the conversation" onClick={onClose}>
              <PiCaretLeftBold size={16} />
            </IconButton>
          </Tooltip>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--gryt-neutral-12)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {thread.title ? <EmojiText text={thread.title} /> : "Thread"}
          </div>
          <div style={{ fontSize: 11, color: "var(--gryt-neutral-10)" }}>
            {thread.reply_count} {thread.reply_count === 1 ? "reply" : "replies"}
            {thread.status === "solved" && <span style={{ color: "var(--gryt-accent-11)", marginLeft: 8 }}>Solved</span>}
            {!takesReplies && <span style={{ color: "var(--gryt-neutral-11)", marginLeft: 8 }}>Closed</span>}
          </div>
        </div>
        {/* The old "Mark solved" was #5cc79a on a #5cc79a border — a green
            picked against the dark theme and left there for the light one.
            Marking something solved is an ordinary action, so it takes the
            accent; the solved *state* keeps the success tone on its chip. */}
        {onSetStatus && (thread.status !== "open" ? (
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
            startIcon={<PiCheck size={14} />}
            title="Mark this topic solved"
            onClick={() => onSetStatus("solved")}
          >
            Mark solved
          </Button>
        ))}
        {onSetStatus && beside && (
          <Divider orientation="vertical" className="my-1 self-stretch" />
        )}
        {beside && (
          <IconButton size="xsmall" aria-label="Close thread" onClick={onClose}>
            <PiX size={16} />
          </IconButton>
        )}
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
        {/* 14 inline, matching the header, the tag row and the composer. Without
            it an avatar sits against the panel edge while the channel's does not. */}
        <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", paddingBottom: 8, paddingInline: 14 }}>
        {root ? (
          <div className="mb-1 border-b border-gryt-border pb-1.5">
            {renderMessage(root)}
          </div>
        ) : !loading && !error ? (
          /* The root can be gone while the replies are not: deleting it takes
             the thread with it, but a blocked sender only hides it. */
          <div className="mb-1 border-b border-gryt-border pb-1.5" style={{ padding: "12px 2px", fontSize: 13, color: "var(--gryt-neutral-10)" }}>
            The message this thread started from is gone.
          </div>
        ) : null}
        {error ? (
          <div style={{ padding: 16, fontSize: 13, color: "var(--gryt-neutral-11)", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
            <span>{error}</span>
            {onRetry && (
              <Button size="xsmall" tone="neutral" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        ) : loading ? (
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
        {takesReplies ? (
          <>
            {typingIndicator}
            {renderComposer()}
          </>
        ) : (
          <p className="m-0 py-1.5 text-center text-xs text-gryt-muted">
            This thread is closed, so you can&rsquo;t reply to it.
          </p>
        )}
      </div>
    </aside>
  );
}
