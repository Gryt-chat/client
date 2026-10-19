import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";

import type { SearchFilter } from "../utils/messageSearch";

export interface MessageSearchHit {
  conversation_id: string;
  message_id: string;
  thread_id: string | null;
  thread_root_message_id: string | null;
  sender_server_id: string;
  sender_display_name: string | null;
  created_at: string;
  /** The match is wrapped in \u0002 … \u0003. */
  snippet: string;
  file?: { file_id: string; name: string | null; mime: string | null; size: number | null };
}

export type SearchKind = "messages" | "files";

interface Results {
  requestId?: string;
  kind?: SearchKind;
  items?: MessageSearchHit[];
  total?: number;
  hasMore?: boolean;
  error?: string;
}

export interface SearchTab {
  items: MessageSearchHit[];
  total: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: SearchTab = { items: [], total: 0, hasMore: false, loading: false, error: null };
const DEBOUNCE_MS = 250;
const PAGE = 25;
// A server from before search never answers, so silence this long means it can't.
const UNANSWERED_MS = 8000;

/** What the server reads off the filters; the last of each key wins. */
function payloadOf(query: string, filters: SearchFilter[]) {
  const p: Record<string, string> = { query: query.trim() };
  for (const f of filters) {
    if (f.key === "from") p.senderServerId = f.value;
    else if (f.key === "in") p.conversationId = f.value;
    else p[f.key] = f.value;
  }
  return p;
}

/** Both tabs of the search panel over `chat:search` (GRYT-1738). Replies to anything but
    the latest request are dropped, so a slow one can't overwrite what the box now says. */
export function useMessageSearch(socketConnection: Socket | null, query: string, filters: SearchFilter[]) {
  const socket = socketConnection;
  const [tabs, setTabs] = useState<Record<SearchKind, SearchTab>>({ messages: EMPTY, files: EMPTY });
  const latest = useRef<Record<SearchKind, string>>({ messages: "", files: "" });
  const appending = useRef<Record<SearchKind, boolean>>({ messages: false, files: false });
  const payload = useRef(payloadOf(query, filters));

  useEffect(() => {
    if (!socket) return;
    const onResults = (r: Results) => {
      const kind = r?.kind ?? "messages";
      if (!r || r.requestId !== latest.current[kind]) return;
      latest.current[kind] = "";
      const append = appending.current[kind];
      setTabs((prev) => ({
        ...prev,
        [kind]: {
          items: append ? [...prev[kind].items, ...(r.items ?? [])] : (r.items ?? []),
          total: r.total ?? prev[kind].total,
          hasMore: !!r.hasMore,
          loading: false,
          error: r.error ?? null,
        },
      }));
    };
    socket.on("chat:search:results", onResults);
    return () => {
      socket.off("chat:search:results", onResults);
    };
  }, [socket]);

  const ask = useCallback((kind: SearchKind, before?: string) => {
    if (!socket) return;
    const requestId = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    latest.current[kind] = requestId;
    appending.current[kind] = !!before;
    socket.emit("chat:search", { ...payload.current, kind, before, limit: PAGE, requestId });
    window.setTimeout(() => {
      if (latest.current[kind] !== requestId) return;
      latest.current[kind] = "";
      setTabs((prev) => ({ ...prev, [kind]: { ...prev[kind], loading: false, error: "unsupported" } }));
    }, UNANSWERED_MS);
  }, [socket]);

  const key = JSON.stringify(payloadOf(query, filters));
  useEffect(() => {
    payload.current = JSON.parse(key);
    const empty = !payload.current.query && Object.keys(payload.current).length === 1;
    if (!socket || empty) {
      latest.current = { messages: "", files: "" };
      setTabs({ messages: EMPTY, files: EMPTY });
      return;
    }
    setTabs((prev) => ({ messages: { ...prev.messages, loading: true }, files: { ...prev.files, loading: true } }));
    const timer = setTimeout(() => {
      ask("messages");
      ask("files");
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [socket, key, ask]);

  const loadMore = useCallback((kind: SearchKind) => {
    const tab = tabs[kind];
    if (tab.loading || !tab.hasMore || tab.items.length === 0) return;
    setTabs((prev) => ({ ...prev, [kind]: { ...prev[kind], loading: true } }));
    ask(kind, tab.items[tab.items.length - 1].created_at);
  }, [tabs, ask]);

  return { tabs, loadMore };
}
