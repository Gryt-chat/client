import { Avatar } from "@gryt/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";
import type { Channel } from "@/settings/src/types/server";

import { PiFileFill, PiMagnifyingGlassBold, PiXBold } from "../../../../lib/icons";
import { type MessageSearchHit, type SearchKind, useMessageSearch } from "../hooks/useMessageSearch";
import { formatFileSize } from "../utils/formatFileSize";
import {
  activeFilterToken,
  groupByDay,
  parseSearchDate,
  SEARCH_FILTER_KEYS,
  type SearchFilter,
  type SearchFilterKey,
  snippetParts,
} from "../utils/messageSearch";
import type { MemberInfo } from "./MemberSidebar";

const PANEL_WIDTH = 380;
const MAX_OPTIONS = 8;

const FILTER_HINTS: Record<SearchFilterKey, string> = {
  from: "a person",
  in: "a channel",
  has: "image, link or file",
  before: "a date",
  after: "a date",
};

const formatTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }) });
}

type Option = { filter: SearchFilter; detail?: string };

/** The search side panel (GRYT-1738): messages and file names on this server, with
    filters as chips. It stays open while you open results, so the chat beside it moves. */
export function SearchPanel({
  socketConnection,
  serverHost,
  serverName,
  channels,
  memberList,
  focusNonce,
  onClose,
  onOpen,
}: {
  socketConnection: unknown;
  serverHost: string;
  serverName: string;
  channels: Channel[];
  memberList?: Record<string, MemberInfo>;
  /** Changes whenever Ctrl/Cmd+K asks for the box again. */
  focusNonce: number;
  onClose: () => void;
  onOpen: (channel: Channel, hit: MessageSearchHit) => void;
}) {
  const [text, setText] = useState("");
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  const [tab, setTab] = useState<SearchKind>("messages");
  const [active, setActive] = useState(0);
  const [option, setOption] = useState(0);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  const textChannels = useMemo(() => channels.filter((c) => c.type === "text"), [channels]);
  const channelById = useMemo(() => new Map(textChannels.map((c) => [c.id, c])), [textChannels]);

  // A half-typed `from:al` is a filter being picked, not words to search for.
  const token = activeFilterToken(text);
  const query = token ? text.slice(0, token.start) : text;
  const { tabs, loadMore } = useMessageSearch(socketConnection, query, filters);
  const shown = tabs[tab];
  const hits = useMemo(() => shown.items.filter((h) => channelById.has(h.conversation_id)), [shown.items, channelById]);
  const searching = !!query.trim() || filters.length > 0;

  const options = useMemo<Option[]>(() => {
    if (!token) return [];
    const q = token.partial.toLowerCase();
    if (token.key === "from") {
      return Object.values(memberList ?? {})
        .filter((m) => m.nickname.toLowerCase().includes(q))
        .slice(0, MAX_OPTIONS)
        .map((m) => ({ filter: { key: "from", value: m.serverUserId, label: m.nickname } }));
    }
    if (token.key === "in") {
      return textChannels
        .filter((c) => c.name.toLowerCase().includes(q.replace(/^#/, "")))
        .slice(0, MAX_OPTIONS)
        .map((c) => ({ filter: { key: "in", value: c.id, label: `#${c.name}` } }));
    }
    if (token.key === "has") {
      return (["image", "link", "file"] as const)
        .filter((v) => v.startsWith(q))
        .map((v) => ({ filter: { key: "has", value: v, label: v } }));
    }
    const dates = q ? [q] : ["today", "yesterday"];
    return dates.flatMap((d) => {
      const date = parseSearchDate(d);
      if (!date) return [];
      const label = date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      // after: a day means from the end of it, so "after yesterday" is today.
      const at = token.key === "after" ? new Date(date.getTime() + 86_400_000 - 1) : date;
      return [{ filter: { key: token.key, value: at.toISOString(), label }, detail: d === label ? undefined : d }];
    });
  }, [token, memberList, textChannels]);

  useEffect(() => setOption(0), [token?.key, token?.partial]);
  useEffect(() => setActive(0), [query, filters, tab]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !shown.hasMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore(tab);
    }, { root: listRef.current, rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.hasMore, loadMore, tab, hits.length]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (o: Option | undefined) => {
    if (!o || !token) return;
    setFilters((prev) => [...prev.filter((f) => f.key !== o.filter.key), o.filter]);
    setText(text.slice(0, token.start));
    inputRef.current?.focus();
  };

  const open = (hit: MessageSearchHit | undefined) => {
    const channel = hit && channelById.get(hit.conversation_id);
    if (!hit || !channel) return;
    setOpenedId(hit.message_id + (hit.file?.file_id ?? ""));
    onOpen(channel, hit);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Backspace" && !text && filters.length > 0) {
      e.preventDefault();
      setFilters((prev) => prev.slice(0, -1));
      return;
    }
    if (token && options.length > 0) {
      if (e.key === "ArrowDown") setOption((i) => Math.min(i + 1, options.length - 1));
      else if (e.key === "ArrowUp") setOption((i) => Math.max(i - 1, 0));
      else if (e.key === "Enter" || e.key === "Tab") pick(options[option]);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, hits.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter") open(hits[active]);
    else if (e.key === "Tab" && searching) setTab((t) => (t === "messages" ? "files" : "messages"));
    else return;
    e.preventDefault();
  };

  const nameOf = (hit: MessageSearchHit) =>
    memberList?.[hit.sender_server_id]?.nickname ?? hit.sender_display_name ?? "Someone";
  const avatarOf = (hit: MessageSearchHit) => {
    const member = memberList?.[hit.sender_server_id];
    const uploaded = member?.avatarFileId ? getUploadsFileUrl(serverHost, member.avatarFileId, { thumb: true }) : undefined;
    if (hit.sender_server_id.startsWith("webhook:")) return uploaded;
    return resolveAvatarSrc(uploaded, nameOf(hit), member?.avatarWorn);
  };
  const count = (n: number) => (n >= 1000 ? "1000+" : String(n));
  const muted = { color: "var(--gryt-neutral-11)" };
  let index = -1;

  return (
    <div
      role="complementary"
      aria-label="Search"
      data-gryt="search-panel"
      className="flex h-full shrink-0 flex-col overflow-hidden"
      style={{ width: PANEL_WIDTH, background: "var(--gryt-neutral-3)", borderRadius: "var(--gryt-radius-lg)" }}
    >
      <div className="flex flex-col gap-2 p-3" style={{ borderBottom: "1px solid var(--gryt-neutral-6)" }}>
        <div className="flex items-center gap-2">
          <div
            className="flex min-w-0 grow flex-wrap items-center gap-1 px-2 py-1"
            style={{ background: "var(--gryt-neutral-1)", border: "1px solid var(--gryt-accent-8)", borderRadius: "var(--gryt-radius-md)", minHeight: 34 }}
            onClick={() => inputRef.current?.focus()}
          >
            <PiMagnifyingGlassBold size={14} style={muted} />
            {filters.map((f) => (
              <span
                key={f.key}
                data-gryt="search-chip"
                className="inline-flex items-center gap-1 text-xs"
                style={{ background: "var(--gryt-accent-5)", color: "var(--gryt-neutral-12)", borderRadius: 6, padding: "2px 2px 2px 6px", whiteSpace: "nowrap" }}
              >
                <span style={{ color: "var(--gryt-accent-11)" }}>{f.key}:</span>
                {f.label}
                <button
                  type="button"
                  aria-label={`Remove ${f.key}: ${f.label}`}
                  className="flex cursor-pointer border-0 bg-transparent p-0.5"
                  style={{ color: "var(--gryt-accent-11)" }}
                  onClick={() => setFilters((prev) => prev.filter((x) => x.key !== f.key))}
                >
                  <PiXBold size={10} />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={filters.length ? "" : `Search ${serverName}`}
              aria-label={`Search ${serverName}`}
              data-gryt="search-input"
              className="min-w-[80px] grow border-0 bg-transparent py-0.5 text-sm outline-none"
              style={{ color: "var(--gryt-neutral-12)" }}
            />
          </div>
          <button
            type="button"
            aria-label="Close search"
            data-gryt="search-close"
            className="flex cursor-pointer rounded border-0 bg-transparent p-1"
            style={muted}
            onClick={onClose}
          >
            <PiXBold size={14} />
          </button>
        </div>
        {searching && (
          <div className="flex items-center gap-1.5" role="tablist">
            {(["messages", "files"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                data-gryt={`search-tab-${k}`}
                className="cursor-pointer text-xs"
                style={{
                  borderRadius: 999,
                  padding: "3px 10px",
                  border: tab === k ? "1px solid transparent" : "1px solid var(--gryt-neutral-6)",
                  background: tab === k ? "var(--gryt-accent-5)" : "transparent",
                  color: "var(--gryt-neutral-12)",
                  fontWeight: tab === k ? 600 : 400,
                }}
                onClick={() => setTab(k)}
              >
                {k === "messages" ? "Messages" : "Files"} {tabs[k].loading && tabs[k].items.length === 0 ? "" : count(tabs[k].total)}
              </button>
            ))}
            <span className="ml-auto text-xs" style={muted}>Newest first</span>
          </div>
        )}
      </div>

      {token ? (
        <div className="flex flex-col py-1" role="listbox" aria-label={`Pick ${token.key}`} data-gryt="search-options">
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm" style={muted}>
              {token.key === "before" || token.key === "after" ? "Type a date like 2026-10-01, or today." : "Nothing matches that."}
            </div>
          ) : (
            options.map((o, i) => (
              <button
                key={o.filter.value}
                type="button"
                role="option"
                aria-selected={i === option}
                className="flex cursor-pointer items-center gap-2 border-0 px-3 py-2 text-left text-sm"
                style={{ background: i === option ? "var(--gryt-neutral-5)" : "transparent", color: "var(--gryt-neutral-12)" }}
                onMouseMove={() => setOption(i)}
                onClick={() => pick(o)}
              >
                <span style={{ color: "var(--gryt-accent-11)" }}>{o.filter.key}:</span>
                {o.filter.label}
                {o.detail && <span className="ml-auto text-xs" style={muted}>{o.detail}</span>}
              </button>
            ))
          )}
        </div>
      ) : !searching ? (
        <div className="flex flex-col gap-2 p-3">
          <div className="text-xs font-semibold uppercase" style={muted}>Narrow it down</div>
          <div className="flex flex-wrap gap-1.5">
            {SEARCH_FILTER_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                data-gryt={`search-hint-${k}`}
                className="cursor-pointer text-xs"
                style={{ borderRadius: 999, padding: "4px 10px", border: "1px solid var(--gryt-neutral-6)", background: "var(--gryt-neutral-2)", color: "var(--gryt-neutral-12)" }}
                onClick={() => {
                  setText((t) => `${t && !t.endsWith(" ") ? `${t} ` : t}${k}:`);
                  inputRef.current?.focus();
                }}
              >
                <span style={{ color: "var(--gryt-accent-11)" }}>{k}:</span> {FILTER_HINTS[k]}
              </button>
            ))}
          </div>
          <div className="mt-2 text-xs" style={muted}>Searches the channels you can read here. Direct messages aren&rsquo;t included.</div>
        </div>
      ) : (
        <div ref={listRef} className="flex min-h-0 grow flex-col gap-1.5 overflow-y-auto px-2.5 pb-3" data-gryt="search-results">
          {groupByDay(hits).map((group) => (
            <div key={group.day} className="flex flex-col gap-1.5">
              <div className="px-0.5 pt-2 text-xs font-semibold" style={muted}>{dayLabel(new Date(group.hits[0].created_at))}</div>
              {group.hits.map((hit) => {
                index += 1;
                const i = index;
                const id = hit.message_id + (hit.file?.file_id ?? "");
                const selected = i === active;
                const opened = id === openedId;
                return (
                  <button
                    key={id}
                    type="button"
                    data-index={i}
                    data-gryt="search-hit"
                    className="flex w-full cursor-pointer gap-2.5 p-2.5 text-left"
                    style={{
                      borderRadius: "var(--gryt-radius-md)",
                      border: `1px solid ${opened || selected ? "var(--gryt-accent-8)" : "var(--gryt-neutral-6)"}`,
                      background: opened ? "var(--gryt-accent-4)" : selected ? "var(--gryt-neutral-4)" : "var(--gryt-neutral-2)",
                      color: "var(--gryt-neutral-12)",
                    }}
                    onMouseMove={() => setActive(i)}
                    onClick={() => open(hit)}
                  >
                    {hit.file ? (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center" style={{ borderRadius: "var(--gryt-radius-sm)", background: "var(--gryt-neutral-4)" }}>
                        <PiFileFill size={16} style={{ color: "var(--gryt-accent-11)" }} />
                      </span>
                    ) : (
                      <Avatar size="small" className="h-8 w-8 shrink-0 text-xs" fallback={nameOf(hit)[0]} src={avatarOf(hit)} />
                    )}
                    <span className="flex min-w-0 grow flex-col gap-0.5">
                      <span className="flex items-baseline gap-1.5 text-xs">
                        <span className="truncate text-sm font-semibold">{hit.file ? hit.file.name || "Unnamed file" : nameOf(hit)}</span>
                        {!hit.file && <span className="shrink-0" style={muted}>{formatTime(new Date(hit.created_at))}</span>}
                        <span className="ml-auto shrink-0" style={muted}>#{channelById.get(hit.conversation_id)?.name}</span>
                      </span>
                      {hit.file ? (
                        <span className="text-xs" style={muted}>
                          {[formatFileSize(hit.file.size), nameOf(hit), formatTime(new Date(hit.created_at))].filter(Boolean).join(" · ")}
                        </span>
                      ) : (
                        <span className="line-clamp-3 text-sm" style={{ color: "var(--gryt-neutral-11)", overflowWrap: "anywhere" }}>
                          {snippetParts(hit.snippet).map((p, k) =>
                            p.match ? (
                              <mark key={k} style={{ background: "var(--gryt-accent-5)", color: "var(--gryt-neutral-12)", borderRadius: 3, padding: "0 1px" }}>{p.text}</mark>
                            ) : (
                              <span key={k}>{p.text}</span>
                            ),
                          )}
                          {!hit.snippet && <span style={muted}>Attachment</span>}
                        </span>
                      )}
                      {hit.thread_id && <span className="text-xs" style={muted}>In a thread</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
          {hits.length === 0 && !shown.loading && (
            <div className="px-1 py-6 text-center text-sm" style={muted}>
              {shown.error === "unsupported"
                ? "This server doesn't support search yet. It needs an update."
                : shown.error === "rate_limited"
                ? "Searching too fast. Give it a few seconds."
                : shown.error
                  ? "Search didn't work this time. Try again."
                  : tab === "files"
                    ? "No files match."
                    : "No messages match."}
            </div>
          )}
          {shown.loading && <div className="px-1 py-3 text-center text-xs" style={muted}>Searching…</div>}
          <div ref={sentinelRef} style={{ height: 1 }} />
        </div>
      )}
    </div>
  );
}
