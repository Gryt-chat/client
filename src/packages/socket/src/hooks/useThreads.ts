import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

import type { ChatMessage } from "../components/chatUtils";

/**
 * A thread is a discussion that hangs off one root message. Its replies carry a
 * thread_id and are kept out of the channel's main list (see handleNewMessage);
 * this hook owns everything about them on the client: the per-root summaries
 * that draw the "N replies" line, and the one open thread panel.
 *
 * It reuses chat:send for replies — a reply is a normal message that carries a
 * threadId — so the server does no new work per reply. GRYT-981.
 */

export interface ThreadSummary {
  thread_id: string;
  conversation_id: string;
  root_message_id: string;
  title: string | null;
  status: "open" | "solved" | "closed";
  reply_count: number;
  last_message_at: string;
}

interface OpenThread {
  thread: ThreadSummary;
  root: ChatMessage | null;
  messages: ChatMessage[];
  loading: boolean;
}

// The slice of a socket.io client this hook touches, so nothing has to be typed
// `any`. serverView hands ChatView the socket as `unknown`.
interface ThreadSocket {
  emit: (event: string, data: unknown) => void;
  on: (event: string, cb: (payload: never) => void) => void;
  off: (event: string, cb: (payload: never) => void) => void;
}

function asSocket(s: unknown): ThreadSocket | null {
  if (!s || typeof s !== "object") return null;
  const c = s as Partial<ThreadSocket>;
  return typeof c.emit === "function" && typeof c.on === "function" && typeof c.off === "function"
    ? (c as ThreadSocket)
    : null;
}

export interface UseThreadsResult {
  /** Keyed by root_message_id, so a message row can look up its own thread. */
  summaries: Record<string, ThreadSummary>;
  open: OpenThread | null;
  startThread: (message: ChatMessage) => void;
  openThread: (rootMessageId: string) => void;
  /** Open a topic straight from a summary the forum index already holds. */
  openSummary: (summary: ThreadSummary) => void;
  closeThread: () => void;
  sendReply: (text: string) => void;
  /** Mark the open topic open / solved / closed. The server gates who may. */
  setStatus: (status: "open" | "solved" | "closed") => void;
}

export function useThreads(
  socketConnection: unknown,
  conversationId: string,
  serverHost: string | undefined,
  currentUserId: string | undefined,
  currentUserNickname: string | undefined,
): UseThreadsResult {
  const [summaries, setSummaries] = useState<Record<string, ThreadSummary>>({});
  const [open, setOpen] = useState<OpenThread | null>(null);

  // Kept in refs so the one set of socket listeners can read the latest without
  // being torn down and re-added on every reply.
  const openRef = useRef<OpenThread | null>(null);
  openRef.current = open;
  // The root someone just started a thread on, so the matching thread:created
  // opens the panel for them and nobody else.
  const pendingOpenRoot = useRef<string | null>(null);

  // Reset when the open conversation changes — summaries and the panel belong
  // to one channel.
  useEffect(() => {
    setSummaries({});
    setOpen(null);
    openRef.current = null;
    pendingOpenRoot.current = null;
  }, [conversationId]);

  useEffect(() => {
    const socket = asSocket(socketConnection);
    if (!socket || !conversationId) return;

    const fetchThread = (thread: ThreadSummary) => {
      setOpen({ thread, root: null, messages: [], loading: true });
      openRef.current = { thread, root: null, messages: [], loading: true };
      socket.emit("thread:fetch", { conversationId, threadId: thread.thread_id });
    };

    const onCreated = (t: ThreadSummary) => {
      if (t.conversation_id !== conversationId) return;
      setSummaries((prev) => ({ ...prev, [t.root_message_id]: t }));
      if (pendingOpenRoot.current === t.root_message_id) {
        pendingOpenRoot.current = null;
        fetchThread(t);
      }
    };

    // Merged, not replaced: thread:updated carries the counters and status that
    // changed, not the whole thread. Overwriting dropped the title, so the panel
    // header fell back to "Thread" the moment anybody replied.
    const onUpdated = (t: Partial<ThreadSummary> & { conversation_id: string; thread_id: string; root_message_id: string }) => {
      if (t.conversation_id !== conversationId) return;
      setSummaries((prev) => ({
        ...prev,
        [t.root_message_id]: { ...prev[t.root_message_id], ...t } as ThreadSummary,
      }));
      if (openRef.current?.thread.thread_id === t.thread_id) {
        setOpen((o) => (o ? { ...o, thread: { ...o.thread, ...t } } : o));
      }
    };

    const onDeleted = (p: { conversation_id: string; thread_id: string; root_message_id: string }) => {
      if (p.conversation_id !== conversationId) return;
      setSummaries((prev) => {
        const next = { ...prev };
        delete next[p.root_message_id];
        return next;
      });
      if (openRef.current?.thread.thread_id === p.thread_id) setOpen(null);
    };

    const onHistory = (p: { conversation_id: string; thread: ThreadSummary; root: ChatMessage | null; items: ChatMessage[] }) => {
      if (p.conversation_id !== conversationId) return;
      if (openRef.current?.thread.thread_id !== p.thread.thread_id) return;
      setOpen({ thread: p.thread, root: p.root, messages: p.items ?? [], loading: false });
    };

    // A thread reply arrives as an ordinary chat:new carrying a thread_id. It is
    // already filtered out of the main list; here it lands in the open panel.
    const onChatNew = (msg: ChatMessage) => {
      if (!msg.thread_id) return;
      const cur = openRef.current;
      if (!cur || cur.thread.thread_id !== msg.thread_id) return;
      setOpen((o) => {
        if (!o) return o;
        const withoutPending = o.messages.filter(
          (m) => !(m.pending && (msg.nonce ? m.nonce === msg.nonce : m.text === msg.text)),
        );
        if (withoutPending.some((m) => m.message_id === msg.message_id)) return { ...o, messages: withoutPending };
        return { ...o, messages: [...withoutPending, msg] };
      });
    };

    const onError = (e: { message?: string } | string) => {
      const message = typeof e === "string" ? e : e?.message;
      if (message) toast.error(message);
    };

    socket.on("thread:created", onCreated as (p: never) => void);
    socket.on("thread:updated", onUpdated as (p: never) => void);
    socket.on("thread:deleted", onDeleted as (p: never) => void);
    socket.on("thread:history", onHistory as (p: never) => void);
    socket.on("thread:error", onError as (p: never) => void);
    socket.on("chat:new", onChatNew as (p: never) => void);
    return () => {
      socket.off("thread:created", onCreated as (p: never) => void);
      socket.off("thread:updated", onUpdated as (p: never) => void);
      socket.off("thread:deleted", onDeleted as (p: never) => void);
      socket.off("thread:history", onHistory as (p: never) => void);
      socket.off("thread:error", onError as (p: never) => void);
      socket.off("chat:new", onChatNew as (p: never) => void);
    };
  }, [socketConnection, conversationId]);

  const startThread = useCallback((message: ChatMessage) => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    if (!socket || !accessToken) return;
    // Already threaded — just open it.
    const existing = summaries[message.message_id];
    if (existing) {
      setOpen({ thread: existing, root: null, messages: [], loading: true });
      openRef.current = { thread: existing, root: null, messages: [], loading: true };
      socket.emit("thread:fetch", { conversationId, threadId: existing.thread_id });
      return;
    }
    pendingOpenRoot.current = message.message_id;
    socket.emit("thread:create", { conversationId, rootMessageId: message.message_id, accessToken });
  }, [socketConnection, conversationId, serverHost, summaries]);

  const openThread = useCallback((rootMessageId: string) => {
    const socket = asSocket(socketConnection);
    const summary = summaries[rootMessageId];
    if (!socket || !summary) return;
    setOpen({ thread: summary, root: null, messages: [], loading: true });
    openRef.current = { thread: summary, root: null, messages: [], loading: true };
    socket.emit("thread:fetch", { conversationId, threadId: summary.thread_id });
  }, [socketConnection, conversationId, summaries]);

  const openSummary = useCallback((summary: ThreadSummary) => {
    const socket = asSocket(socketConnection);
    if (!socket) return;
    setOpen({ thread: summary, root: null, messages: [], loading: true });
    openRef.current = { thread: summary, root: null, messages: [], loading: true };
    socket.emit("thread:fetch", { conversationId, threadId: summary.thread_id });
  }, [socketConnection, conversationId]);

  const closeThread = useCallback(() => setOpen(null), []);

  const setStatus = useCallback((status: "open" | "solved" | "closed") => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    const cur = openRef.current;
    if (!socket || !accessToken || !cur) return;
    socket.emit("thread:status:set", { conversationId, threadId: cur.thread.thread_id, status, accessToken });
  }, [socketConnection, conversationId, serverHost]);

  const sendReply = useCallback((text: string) => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    const cur = openRef.current;
    const trimmed = text.trim();
    if (!socket || !accessToken || !cur || !trimmed) return;
    const nonce = crypto.randomUUID();
    const optimistic: ChatMessage = {
      conversation_id: conversationId,
      message_id: nonce,
      sender_server_id: currentUserId || "",
      text: trimmed,
      attachments: null,
      reactions: null,
      created_at: new Date(),
      thread_id: cur.thread.thread_id,
      pending: true,
      nonce,
      sender_nickname: currentUserNickname,
    };
    setOpen((o) => (o ? { ...o, messages: [...o.messages, optimistic] } : o));
    socket.emit("chat:send", { conversationId, threadId: cur.thread.thread_id, text: trimmed, accessToken, nonce });
  }, [socketConnection, conversationId, serverHost, currentUserId, currentUserNickname]);

  return { summaries, open, startThread, openThread, openSummary, closeThread, sendReply, setStatus };
}
