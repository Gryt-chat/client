import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { clearThreadMentions, getServerAccessToken, setOpenThread } from "@/common";

import type { ChatMessage } from "../components/chatUtils";
import { uploadChatFile } from "./uploadChatFile";

/**
 * A thread hangs off one root message; its replies carry a thread_id and stay out
 * of the channel list. Replies reuse chat:send, so the server does no more work.
 */

export interface ThreadSummary {
  thread_id: string;
  conversation_id: string;
  root_message_id: string;
  title: string | null;
  status: "open" | "solved" | "closed";
  reply_count: number;
  last_message_at: string;
  /** Tag ids from the channel's palette. Absent on a plain chat thread. */
  tags?: string[];
}

interface OpenThread {
  thread: ThreadSummary;
  root: ChatMessage | null;
  messages: ChatMessage[];
  loading: boolean;
  /** Whether there is a page older than the first message held. */
  hasOlder: boolean;
  /** A page is on its way, so the scroll handler does not ask twice. */
  loadingOlder: boolean;
}

// The slice of a socket.io client this hook touches, so nothing has to be typed
// `any`. serverView hands ChatView the socket as `unknown`.
interface ThreadSocket {
  emit: (event: string, data: unknown) => void;
  on: (event: string, cb: (payload: never) => void) => void;
  off: (event: string, cb: (payload: never) => void) => void;
}

/**
 * Opening a thread is reading it: the unread count, the mention count and the
 * server are done together because splitting them is how they drift (GRYT-1014).
 */
function enterThread(
  socket: ThreadSocket,
  host: string,
  conversationId: string,
  threadId: string,
) {
  setOpenThread(host, threadId);
  clearThreadMentions(host, threadId);
  socket.emit("mentions:seen", { conversationId, threadId });
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
  /** Files go up the same way a channel's do; nothing here is sealed. */
  sendReply: (text: string, files?: File[], replyToMessageId?: string) => void;
  /** Fetch the page before the oldest reply held. No-op when there is none. */
  loadOlder: () => void;
  /** Set the open topic's tags. The server gates who may, and drops unknown ids. */
  setTags: (tagIds: string[]) => void;
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
  // The reply we are waiting on, so a refusal can mark that one failed rather
  // than leaving it sitting there looking sent.
  const pendingReply = useRef<string | null>(null);

  // Reset when the open conversation changes — summaries and the panel belong
  // to one channel.
  useEffect(() => {
    setSummaries({});
    setOpenThread(serverHost || "", null);
    setOpen(null);
    openRef.current = null;
    pendingOpenRoot.current = null;
  }, [conversationId, serverHost]);

  useEffect(() => {
    const socket = asSocket(socketConnection);
    if (!socket || !conversationId) return;

    const fetchThread = (thread: ThreadSummary) => {
      setOpen({ thread, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false });
      openRef.current = { thread, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false };
      enterThread(socket, serverHost || "", conversationId, thread.thread_id);
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

    // Merged, not replaced: thread:updated carries what changed. Overwriting
    // dropped the title, so the header fell back to "Thread" on every reply.
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
      if (openRef.current?.thread.thread_id === p.thread_id) setOpenThread(serverHost || "", null);
      setOpen(null);
    };

    const onHistory = (p: {
      conversation_id: string;
      thread: ThreadSummary;
      root: ChatMessage | null;
      items: ChatMessage[];
      hasMore?: boolean;
      before?: string;
    }) => {
      if (p.conversation_id !== conversationId) return;
      if (openRef.current?.thread.thread_id !== p.thread.thread_id) return;
      const items = p.items ?? [];
      setOpen((o) => {
        // Merged like thread:updated: history carries the thread, but not the
        // tags the forum index already knew about.
        const thread = { ...o?.thread, ...p.thread } as ThreadSummary;

        /* A page fetched with `before` goes in front of what is held; the first
           page replaces it. Without that, scrolling back threw away the newer. */
        if (p.before && o) {
          const known = new Set(o.messages.map((m) => m.message_id));
          const older = items.filter((m) => !known.has(m.message_id));
          return {
            ...o,
            thread,
            // The root rides on the first page only, so an older page must not
            // blank the topic sitting above the divider.
            root: o.root,
            messages: [...older, ...o.messages],
            loading: false,
            loadingOlder: false,
            hasOlder: p.hasMore ?? false,
          };
        }

        return {
          thread,
          root: p.root,
          messages: items,
          loading: false,
          loadingOlder: false,
          hasOlder: p.hasMore ?? false,
        };
      });
    };

    // A thread reply arrives as an ordinary chat:new carrying a thread_id. It is
    // already filtered out of the main list; here it lands in the open panel.
    const onChatNew = (msg: ChatMessage) => {
      if (!msg.thread_id) return;
      const cur = openRef.current;
      if (!cur || cur.thread.thread_id !== msg.thread_id) return;
      if (msg.nonce && pendingReply.current === msg.nonce) pendingReply.current = null;
      setOpen((o) => {
        if (!o) return o;
        const withoutPending = o.messages.filter(
          (m) => !(m.pending && (msg.nonce ? m.nonce === msg.nonce : m.text === msg.text)),
        );
        if (withoutPending.some((m) => m.message_id === msg.message_id)) return { ...o, messages: withoutPending };
        return { ...o, messages: [...withoutPending, msg] };
      });
    };

    /*
     * Reactions, deletes and edits arrive keyed on the message, not the thread.
     * Guarded on the open thread because a delete carries no thread id.
     */
    const patchOpen = (
      messageId: string,
      apply: (messages: ChatMessage[]) => ChatMessage[],
    ) => {
      setOpen((o) => {
        if (!o) return o;
        const inRoot = o.root?.message_id === messageId;
        const inReplies = o.messages.some((m) => m.message_id === messageId);
        if (!inRoot && !inReplies) return o;
        return { ...o, messages: apply(o.messages) };
      });
    };

    const onReaction = (updated: ChatMessage) => {
      if (!updated?.message_id) return;
      patchOpen(updated.message_id, (messages) =>
        messages.map((m) => (m.message_id === updated.message_id ? { ...m, reactions: updated.reactions } : m)),
      );
      // The root sits above the divider and is held separately.
      setOpen((o) =>
        o && o.root?.message_id === updated.message_id
          ? { ...o, root: { ...o.root, reactions: updated.reactions } }
          : o,
      );
    };

    const onEdited = (updated: ChatMessage) => {
      if (!updated?.message_id) return;
      patchOpen(updated.message_id, (messages) =>
        messages.map((m) => (m.message_id === updated.message_id ? { ...m, ...updated } : m)),
      );
      setOpen((o) =>
        o && o.root?.message_id === updated.message_id ? { ...o, root: { ...o.root, ...updated } } : o,
      );
    };

    /*
     * A deleted root closes the panel rather than leaving a thread hanging off
     * nothing. Its replies are gone on the server too — the topic is the root.
     */
    const onMessageDeleted = (payload: { conversation_id: string; message_id: string }) => {
      const id = payload?.message_id;
      if (!id) return;
      const cur = openRef.current;
      if (!cur) return;
      if (cur.root?.message_id === id) {
        setOpenThread(serverHost || "", null);
      setOpen(null);
        return;
      }
      patchOpen(id, (messages) => messages.filter((m) => m.message_id !== id));
    };

    const onError = (e: { message?: string } | string) => {
      const message = typeof e === "string" ? e : e?.message;
      if (message) toast.error(message);
    };

    // A reply the server refused must stop looking like it sent. Marked failed
    // the way the main chat marks one, instead of sitting there until a reload.
    const onChatError = (e: { message?: string } | string) => {
      const nonce = pendingReply.current;
      if (!nonce) return;
      pendingReply.current = null;
      const message = typeof e === "string" ? e : e?.message;
      if (message) toast.error(message);
      setOpen((o) =>
        o
          ? { ...o, messages: o.messages.map((m) => (m.nonce === nonce ? { ...m, pending: false, failed: true } : m)) }
          : o,
      );
    };

    socket.on("thread:created", onCreated as (p: never) => void);
    socket.on("thread:updated", onUpdated as (p: never) => void);
    socket.on("thread:deleted", onDeleted as (p: never) => void);
    socket.on("thread:history", onHistory as (p: never) => void);
    socket.on("thread:error", onError as (p: never) => void);
    socket.on("chat:error", onChatError as (p: never) => void);
    socket.on("chat:new", onChatNew as (p: never) => void);
    socket.on("chat:reaction", onReaction as (p: never) => void);
    socket.on("chat:edited", onEdited as (p: never) => void);
    socket.on("chat:deleted", onMessageDeleted as (p: never) => void);
    return () => {
      socket.off("thread:created", onCreated as (p: never) => void);
      socket.off("thread:updated", onUpdated as (p: never) => void);
      socket.off("thread:deleted", onDeleted as (p: never) => void);
      socket.off("thread:history", onHistory as (p: never) => void);
      socket.off("thread:error", onError as (p: never) => void);
      socket.off("chat:error", onChatError as (p: never) => void);
      socket.off("chat:new", onChatNew as (p: never) => void);
      socket.off("chat:reaction", onReaction as (p: never) => void);
      socket.off("chat:edited", onEdited as (p: never) => void);
      socket.off("chat:deleted", onMessageDeleted as (p: never) => void);
    };
  }, [socketConnection, conversationId, serverHost]);

  const startThread = useCallback((message: ChatMessage) => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    if (!socket || !accessToken) return;
    // Already threaded — just open it.
    const existing = summaries[message.message_id];
    if (existing) {
      setOpen({ thread: existing, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false });
      openRef.current = { thread: existing, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false };
      enterThread(socket, serverHost || "", conversationId, existing.thread_id);
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
    setOpen({ thread: summary, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false });
    openRef.current = { thread: summary, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false };
    enterThread(socket, serverHost || "", conversationId, summary.thread_id);
    socket.emit("thread:fetch", { conversationId, threadId: summary.thread_id });
  }, [socketConnection, conversationId, summaries, serverHost]);

  const openSummary = useCallback((summary: ThreadSummary) => {
    const socket = asSocket(socketConnection);
    if (!socket) return;
    setOpen({ thread: summary, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false });
    openRef.current = { thread: summary, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false };
    enterThread(socket, serverHost || "", conversationId, summary.thread_id);
    socket.emit("thread:fetch", { conversationId, threadId: summary.thread_id });
  }, [socketConnection, conversationId, serverHost]);

  const closeThread = useCallback(() => {
    setOpenThread(serverHost || "", null);
    setOpen(null);
  }, [serverHost]);

  const setTags = useCallback((tagIds: string[]) => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    const cur = openRef.current;
    if (!socket || !accessToken || !cur) return;
    socket.emit("thread:tags:set", { conversationId, threadId: cur.thread.thread_id, tagIds, accessToken });
  }, [socketConnection, conversationId, serverHost]);

  const setStatus = useCallback((status: "open" | "solved" | "closed") => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    const cur = openRef.current;
    if (!socket || !accessToken || !cur) return;
    socket.emit("thread:status:set", { conversationId, threadId: cur.thread.thread_id, status, accessToken });
  }, [socketConnection, conversationId, serverHost]);

  /**
   * Post into the open thread. Nothing here is sealed: a thread cannot be started
   * in a DM, so the seal argument is left off rather than threaded through as null.
   */
  const sendReply = useCallback((text: string, files: File[] = [], replyToMessageId?: string) => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    const cur = openRef.current;
    const trimmed = text.trim();
    if (!socket || !accessToken || !cur) return;
    if (!trimmed && files.length === 0) return;

    const nonce = crypto.randomUUID();
    pendingReply.current = nonce;

    const localIds = files.map(() => `local-${crypto.randomUUID()}`);
    const optimistic: ChatMessage = {
      conversation_id: conversationId,
      message_id: nonce,
      sender_server_id: currentUserId || "",
      text: trimmed || null,
      attachments: localIds.length ? localIds : null,
      enriched_attachments: files.length
        ? files.map((f, i) => ({
            file_id: localIds[i],
            mime: f.type || null,
            size: f.size,
            original_name: f.name,
            width: null,
            height: null,
            has_thumbnail: false,
            local_url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
          }))
        : null,
      reactions: null,
      reply_to_message_id: replyToMessageId || null,
      created_at: new Date(),
      thread_id: cur.thread.thread_id,
      pending: true,
      nonce,
      sender_nickname: currentUserNickname,
    };
    setOpen((o) => (o ? { ...o, messages: [...o.messages, optimistic] } : o));

    void (async () => {
      let fileIds: string[] | null = null;
      if (files.length > 0) {
        try {
          const uploaded = await Promise.all(
            files.map((f) => uploadChatFile(f, serverHost || "")),
          );
          fileIds = uploaded.map((u) => u.fileId);
        } catch (err) {
          const msg = err instanceof Error && err.message ? err.message : "Failed to upload file(s)";
          toast.error(msg);
          // The optimistic row is marked rather than removed, the same way a
          // failed send is in a channel — a reply that vanishes reads as sent.
          setOpen((o) =>
            o
              ? {
                  ...o,
                  messages: o.messages.map((m) =>
                    m.message_id === nonce ? { ...m, pending: false, failed: true } : m,
                  ),
                }
              : o,
          );
          return;
        }
      }
      socket.emit("chat:send", {
        conversationId,
        threadId: cur.thread.thread_id,
        text: trimmed,
        attachments: fileIds,
        replyToMessageId,
        accessToken,
        nonce,
      });
    })();
  }, [socketConnection, conversationId, serverHost, currentUserId, currentUserNickname]);

  /**
   * Ask for the page before the oldest reply held. A no-op while one is in flight
   * or after a short page: the scroll handler fires on every frame of a flick.
   */
  const loadOlder = useCallback(() => {
    const socket = asSocket(socketConnection);
    const cur = openRef.current;
    if (!socket || !cur || cur.loadingOlder || !cur.hasOlder) return;
    const oldest = cur.messages[0];
    if (!oldest) return;
    setOpen((o) => (o ? { ...o, loadingOlder: true } : o));
    socket.emit("thread:fetch", {
      conversationId,
      threadId: cur.thread.thread_id,
      before: new Date(oldest.created_at).toISOString(),
    });
  }, [socketConnection, conversationId]);

  return { summaries, open, startThread, openThread, openSummary, closeThread, sendReply, setTags, setStatus, loadOlder };
}
