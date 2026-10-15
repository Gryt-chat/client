import { useCallback, useEffect, useState } from "react";

import { type ArchivedMessage, identityScopeFor, openLocalArchive } from "@/common";

import type { SearchFilter } from "../utils/messageSearch";
import type { MessageSearchHit, SearchKind, SearchTab } from "./useMessageSearch";

/** A conversation the messages space can search: where it lives, and what to call it. */
export interface LocalConversation {
  host: string;
  conversationId: string;
  title: string;
}

const EMPTY: SearchTab = { items: [], total: 0, hasMore: false, loading: false, error: null };
const DEBOUNCE_MS = 200;
const BATCH = 500;
/** Enough to page through by scrolling; past this the box wants narrowing. */
const MAX_HITS = 1000;
const LINK = /https?:\/\/\S+/i;
const SNIPPET = 90;

/** The match wrapped in \u0002 … \u0003, the way the server marks it, with some text either side. */
export function localSnippet(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!needle) return flat.slice(0, SNIPPET);
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return flat.slice(0, SNIPPET);
  const start = Math.max(0, at - 30);
  const end = Math.min(flat.length, at + needle.length + SNIPPET - 30);
  return `${start > 0 ? "…" : ""}${flat.slice(start, at)}\u0002${flat.slice(at, at + needle.length)}\u0003${flat.slice(at + needle.length, end)}${end < flat.length ? "…" : ""}`;
}

/** Whether one archived message passes the filters, apart from the words. */
function passes(m: ArchivedMessage, filters: SearchFilter[]): boolean {
  for (const f of filters) {
    if (f.key === "from" && m.senderId !== f.value) return false;
    if (f.key === "before" && m.sentAt >= Date.parse(f.value)) return false;
    if (f.key === "after" && m.sentAt <= Date.parse(f.value)) return false;
    if (f.key === "has") {
      const keys = Object.values(m.attachments);
      if (f.value === "link" && !LINK.test(m.text)) return false;
      if (f.value === "file" && keys.length === 0) return false;
      if (f.value === "image" && !keys.some((k) => k.mime?.startsWith("image/"))) return false;
    }
  }
  return true;
}

/**
 * Search over this device's own copy of its direct messages (GRYT-1748), in the
 * same shape as the server search, so one panel draws both. Nothing leaves the device.
 */
export function useLocalDmSearch(conversations: LocalConversation[] | null, query: string, filters: SearchFilter[]) {
  const [tabs, setTabs] = useState<Record<SearchKind, SearchTab>>({ messages: EMPTY, files: EMPTY });
  const key = JSON.stringify([conversations?.map((c) => [c.host, c.conversationId]), query.trim().toLowerCase(), filters]);

  useEffect(() => {
    const needle = query.trim().toLowerCase();
    if (!conversations || (!needle && filters.length === 0)) {
      setTabs({ messages: EMPTY, files: EMPTY });
      return;
    }
    let live = true;
    setTabs((prev) => ({ messages: { ...prev.messages, loading: true }, files: { ...prev.files, loading: true } }));
    const timer = setTimeout(() => {
      void (async () => {
        const archive = await openLocalArchive().catch(() => null);
        if (!live) return;
        if (!archive) {
          setTabs({ messages: { ...EMPTY, error: "unsupported" }, files: { ...EMPTY, error: "unsupported" } });
          return;
        }
        const inOne = filters.find((f) => f.key === "in")?.value;
        const messages: MessageSearchHit[] = [];
        const files: MessageSearchHit[] = [];
        for (const c of conversations) {
          if (inOne && c.conversationId !== inOne) continue;
          const scope = identityScopeFor(c.host);
          let before: { sentAt: number; messageId: string } | undefined;
          for (;;) {
            const page = await archive.messages.page(scope, c.conversationId, { before, limit: BATCH });
            if (!live) return;
            for (const m of page) {
              if (!passes(m, filters)) continue;
              const hit = {
                conversation_id: c.conversationId,
                message_id: m.messageId,
                thread_id: null,
                thread_root_message_id: null,
                sender_server_id: m.senderId,
                sender_display_name: null,
                created_at: new Date(m.sentAt).toISOString(),
              };
              if (!needle || m.text.toLowerCase().includes(needle)) {
                if (m.text) messages.push({ ...hit, snippet: localSnippet(m.text, needle) });
              }
              for (const [fileId, k] of Object.entries(m.attachments)) {
                if (needle && !(k.name ?? "").toLowerCase().includes(needle)) continue;
                files.push({ ...hit, snippet: "", file: { file_id: fileId, name: k.name ?? null, mime: k.mime ?? null, size: k.size ?? null } });
              }
            }
            if (page.length < BATCH || messages.length + files.length > MAX_HITS) break;
            before = { sentAt: page[0].sentAt, messageId: page[0].messageId };
          }
        }
        const newest = (a: MessageSearchHit, b: MessageSearchHit) => b.created_at.localeCompare(a.created_at);
        const tab = (items: MessageSearchHit[]): SearchTab => ({ items: items.sort(newest).slice(0, MAX_HITS), total: items.length, hasMore: false, loading: false, error: null });
        setTabs({ messages: tab(messages), files: tab(files) });
      })();
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` is the identity of the arguments; the arrays themselves are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Everything is read at once, so there's never a next page.
  const loadMore = useCallback(() => {}, []);
  return { tabs, loadMore };
}
