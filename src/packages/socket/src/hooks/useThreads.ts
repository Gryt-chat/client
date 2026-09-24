import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { clearThreadMentions, getServerAccessToken, setOpenThread } from "@/common";

import type { ChatMessage } from "../components/chatUtils";
import { mergeSender, mergeSenders } from "../utils/mergeSender";
import { type ChatErrorPayload, type ChatErrorRef, isMutedError, isNonRetryableError } from "./chatEventHandlers";
import { mergeMessages } from "./mergeMessages";
import { forgetOpenThread, recallOpenThread, rememberOpenThread } from "./openThreadMemory";
import { draftKey, returnDraft } from "./returnedDrafts";
import { type EmitResult, type QueueSocket, SendQueue } from "./sendQueue";
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
  /* Who started it. The server lets them and a moderator set the status and
     refuses everyone else, so the control is drawn off this. */
  created_by?: string;
  /** Locked to new replies, the way closed is. chat:send refuses both. */
  locked?: boolean;
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
  /** Why the replies are not here. Drawn in their place, with a way to retry. */
  error: string | null;
}

/** The panel as it looks with the fetch in flight. Four call sites open one. */
function pendingOpen(thread: ThreadSummary): OpenThread {
  return { thread, root: null, messages: [], loading: true, hasOlder: false, loadingOlder: false, error: null };
}

/** A reply waiting on the server, kept so a refusal can send it a second time. */
interface ThreadRetryEntry {
  payload: {
    conversationId: string;
    threadId: string;
    text: string;
    attachments: string[] | null;
    replyToMessageId?: string;
    nonce: string;
  };
  // The files as picked rather than as uploaded: a resend puts them up again
  // instead of naming keys the first attempt never finished writing.
  files: File[];
  retryCount: number;
  timeoutId?: ReturnType<typeof setTimeout>;
  /** The thread's composer, fixed when it was sent, for the text to go back to. */
  returnTo: string;
}

/** The same wait useChatSend gives a channel message. */
const RETRY_AFTER_MS = 3000;

/* The newest reply still waiting, retried or not. Only looking at the ones with
   a retry left meant the second refusal fell through and left the row pending. */
function latestPending(queue: Map<string, ThreadRetryEntry>): ThreadRetryEntry | null {
  let latest: ThreadRetryEntry | null = null;
  for (const entry of queue.values()) latest = entry;
  return latest;
}

/* The reply a refusal is about. A nonce names it (GRYT-1410), and one not held here
   is a channel send's or already settled. A server without it gets the newest. */
function refusedReply(queue: Map<string, ThreadRetryEntry>, ref?: ChatErrorRef): ThreadRetryEntry | null {
  const nonce = ref && typeof ref === "object" && typeof ref.nonce === "string" ? ref.nonce : null;
  return nonce ? queue.get(nonce) ?? null : latestPending(queue);
}

function errorText(e: ChatErrorPayload): string {
  if (typeof e === "string") return e || "Something went wrong.";
  return e?.message || e?.error || "Something went wrong.";
}

// The slice of a socket.io client this hook touches, so nothing has to be typed
// `any`. serverView hands ChatView the socket as `unknown`.
interface ThreadSocket extends QueueSocket {
  emit: (event: string, data: unknown) => void;
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
  /** Ask for the open thread again, after the panel drew a refusal. */
  retryFetch: () => void;
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
  /* Replies waiting on the server, keyed by nonce. The channel keeps the same
     queue in useChatSend; a refusal retries once and then gives the text back. */
  const retryQueueRef = useRef<Map<string, ThreadRetryEntry>>(new Map());
  /* Reply ids chat:deleted took out, as the channel keeps them (GRYT-1217), so a
     page the server read before the delete can't put one back. */
  const deletedIdsRef = useRef<Set<string>>(new Set());

  /* The panel belongs to one channel, so it closes on a switch — but not when
     this hook is mounted again on the same one, which a resize does (GRYT-1390). */
  useEffect(() => {
    if (recallOpenThread(serverHost || "", conversationId)) return;
    setOpenThread(serverHost || "", null);
    forgetOpenThread();
    setOpen(null);
    openRef.current = null;
    pendingOpenRoot.current = null;
  }, [conversationId, serverHost]);

  /* Remembered on every change, so what comes back after a remount carries the
     title and the reply count rather than the placeholder the fetch starts from. */
  useEffect(() => {
    if (open) rememberOpenThread(serverHost || "", conversationId, open.thread);
  }, [open, conversationId, serverHost]);

  /* Summaries outlive a channel switch, the way the message cache does: come
     back inside the cache window and no chat:fetch reseeds them (GRYT-1386). */
  useEffect(() => {
    setSummaries({});
  }, [serverHost]);

  const queueRef = useRef<SendQueue | null>(null);

  /* The row stops looking sent, and the text lands back in the thread's composer the
     way a channel's does. Keyed by where it was sent, since the panel may have moved on. */
  const failReply = useCallback((nonce: string) => {
    const entry = retryQueueRef.current.get(nonce);
    if (entry?.timeoutId) clearTimeout(entry.timeoutId);
    retryQueueRef.current.delete(nonce);
    queueRef.current?.settle(nonce);
    setOpen((o) =>
      o
        ? { ...o, messages: o.messages.map((m) => (m.nonce === nonce ? { ...m, pending: false, waiting: false, failed: true } : m)) }
        : o,
    );
    if (!entry) return;
    returnDraft(entry.returnTo, { text: entry.payload.text, files: entry.files });
  }, []);

  /* One queue per socket, which outlives a channel switch: a reply waiting on the
     server still goes out, or fails back into its thread's composer. */
  useEffect(() => {
    const socket = asSocket(socketConnection);
    if (!socket) return;
    const replies = retryQueueRef.current;
    const queue = new SendQueue(socket, {
      emit: async (nonce): Promise<EmitResult> => {
        const entry = replies.get(nonce);
        if (!entry) return "failed";
        if (socket.connected === false) return "offline";
        const token = getServerAccessToken(serverHost || "");
        if (!token) return "failed";
        socket.emit("chat:send", { ...entry.payload, accessToken: token });
        return "sent";
      },
      onGiveUp: failReply,
      onWaiting: (nonce, waiting) =>
        setOpen((o) =>
          o && o.messages.some((m) => m.nonce === nonce && m.pending && !!m.waiting !== waiting)
            ? { ...o, messages: o.messages.map((m) => (m.nonce === nonce ? { ...m, waiting } : m)) }
            : o,
        ),
    });
    queueRef.current = queue;
    return () => {
      queueRef.current = null;
      queue.dispose();
      for (const entry of replies.values()) {
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
      }
      replies.clear();
    };
  }, [socketConnection, serverHost, failReply]);

  useEffect(() => {
    const socket = asSocket(socketConnection);
    if (!socket || !conversationId) return;

    const fetchThread = (thread: ThreadSummary) => {
      const opening = pendingOpen(thread);
      setOpen(opening);
      openRef.current = opening;
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
      // Only the panel showing this thread. Outside the guard, any delete in
      // the channel shut whatever you had open (GRYT-1387).
      if (openRef.current?.thread.thread_id === p.thread_id) {
        setOpenThread(serverHost || "", null);
        forgetOpenThread();
        setOpen(null);
      }
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
        /* Either page is merged into what is held. A reply that landed while the
           first page was on its way isn't in it, and replacing dropped it (GRYT-1241). */
        const held = o?.thread.thread_id === p.thread.thread_id ? o.messages : [];
        return {
          thread,
          // The root rides on the first page only, so an older page must not
          // blank the topic sitting above the divider.
          root: p.before && o ? o.root : p.root,
          messages: mergeMessages(held, items, deletedIdsRef.current),
          loading: false,
          loadingOlder: false,
          hasOlder: p.hasMore ?? false,
          error: null,
        };
      });
    };

    /* Every page of channel history carries the threads hanging off it, so a
       reload reads the same counts as somebody who watched them arrive. */
    const onChannelHistory = (p: { conversation_id: string; threads?: ThreadSummary[] }) => {
      const incoming = p?.threads;
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      setSummaries((prev) => {
        const next = { ...prev };
        for (const t of incoming) {
          if (!t?.root_message_id) continue;
          next[t.root_message_id] = { ...next[t.root_message_id], ...t };
        }
        return next;
      });
    };

    // A thread reply arrives as an ordinary chat:new carrying a thread_id. It is
    // already filtered out of the main list; here it lands in the open panel.
    const onChatNew = (msg: ChatMessage) => {
      if (!msg.thread_id) return;
      // Before the open-thread check: a reply confirmed after the panel moved on is still done.
      if (msg.nonce) {
        const done = retryQueueRef.current.get(msg.nonce);
        if (done?.timeoutId) clearTimeout(done.timeoutId);
        retryQueueRef.current.delete(msg.nonce);
      }
      if (deletedIdsRef.current.has(msg.message_id)) return;
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
      // Before the guards: the page it has to be kept out of may not be here yet.
      deletedIdsRef.current.add(id);
      const cur = openRef.current;
      if (!cur) return;
      if (cur.root?.message_id === id) {
        setOpenThread(serverHost || "", null);
      setOpen(null);
        return;
      }
      patchOpen(id, (messages) => messages.filter((m) => m.message_id !== id));
    };

    const onMergeUser = (payload: { from_server_user_id?: string; to_server_user_id?: string }) => {
      const from = payload?.from_server_user_id;
      const to = payload?.to_server_user_id;
      if (!from || !to) return;
      setOpen((o) => {
        if (!o) return o;
        const root = o.root ? mergeSender(o.root, from, to) : o.root;
        const messages = mergeSenders(o.messages, from, to);
        return root === o.root && messages === o.messages ? o : { ...o, root, messages };
      });
    };

    /* A refused fetch is drawn where the replies would be. Toasted only when
       there is no panel to draw it in, or nothing was on its way. */
    const onError = (e: ChatErrorPayload) => {
      const message = errorText(e);
      const cur = openRef.current;
      if (cur && (cur.loading || cur.loadingOlder)) {
        setOpen((o) => (o ? { ...o, loading: false, loadingOlder: false, error: message } : o));
        return;
      }
      toast.error(message);
    };

    /* A refused reply follows the channel: one automatic retry, and if that
       goes too the row is marked failed and the text goes back in the box. */
    const onChatError = (e: ChatErrorPayload, ref?: ChatErrorRef) => {
      const entry = refusedReply(retryQueueRef.current, ref);
      if (!entry) return;

      if (!isNonRetryableError(e) && entry.retryCount < 1) {
        const wait = typeof e === "object" && e?.retryAfterMs && e.retryAfterMs > 0 ? e.retryAfterMs : RETRY_AFTER_MS;
        const nonce = entry.payload.nonce;
        entry.retryCount++;
        queueRef.current?.hold(nonce);
        entry.timeoutId = setTimeout(() => queueRef.current?.resend(nonce), wait);
        return;
      }

      failReply(entry.payload.nonce);
      // The composer draws the mute, and the server's own wording carries a raw ISO date.
      if (!isMutedError(e)) toast.error(errorText(e));
    };

    /* The panel was open before the window was resized and this hook was mounted
       again. Ask for the thread a second time rather than drawing a stale one. */
    const recalled = recallOpenThread(serverHost || "", conversationId);
    if (recalled && openRef.current?.thread.thread_id !== recalled.thread_id) fetchThread(recalled);

    socket.on("thread:created", onCreated as (p: never) => void);
    socket.on("thread:updated", onUpdated as (p: never) => void);
    socket.on("thread:deleted", onDeleted as (p: never) => void);
    socket.on("thread:history", onHistory as (p: never) => void);
    socket.on("chat:history", onChannelHistory as (p: never) => void);
    socket.on("thread:error", onError as (p: never) => void);
    socket.on("chat:error", onChatError as (p: never) => void);
    socket.on("chat:new", onChatNew as (p: never) => void);
    socket.on("chat:reaction", onReaction as (p: never) => void);
    socket.on("chat:edited", onEdited as (p: never) => void);
    socket.on("chat:deleted", onMessageDeleted as (p: never) => void);
    socket.on("chat:merge_user", onMergeUser as (p: never) => void);
    return () => {
      socket.off("thread:created", onCreated as (p: never) => void);
      socket.off("thread:updated", onUpdated as (p: never) => void);
      socket.off("thread:deleted", onDeleted as (p: never) => void);
      socket.off("thread:history", onHistory as (p: never) => void);
      socket.off("chat:history", onChannelHistory as (p: never) => void);
      socket.off("thread:error", onError as (p: never) => void);
      socket.off("chat:error", onChatError as (p: never) => void);
      socket.off("chat:new", onChatNew as (p: never) => void);
      socket.off("chat:reaction", onReaction as (p: never) => void);
      socket.off("chat:edited", onEdited as (p: never) => void);
      socket.off("chat:deleted", onMessageDeleted as (p: never) => void);
      socket.off("chat:merge_user", onMergeUser as (p: never) => void);
    };
  }, [socketConnection, conversationId, serverHost, failReply]);

  const startThread = useCallback((message: ChatMessage) => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    if (!socket || !accessToken) return;
    /* A dead socket swallows the emit, and the root stays queued to open a panel
       that no thread:created ever arrives for. Say so instead (GRYT-1389). */
    if (socket.connected === false) {
      toast.error("Not connected to this server");
      return;
    }
    // Already threaded — just open it.
    const existing = summaries[message.message_id];
    if (existing) {
      const opening = pendingOpen(existing);
      setOpen(opening);
      openRef.current = opening;
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
    const opening = pendingOpen(summary);
    setOpen(opening);
    openRef.current = opening;
    enterThread(socket, serverHost || "", conversationId, summary.thread_id);
    socket.emit("thread:fetch", { conversationId, threadId: summary.thread_id });
  }, [socketConnection, conversationId, summaries, serverHost]);

  const openSummary = useCallback((summary: ThreadSummary) => {
    const socket = asSocket(socketConnection);
    if (!socket) return;
    const opening = pendingOpen(summary);
    setOpen(opening);
    openRef.current = opening;
    enterThread(socket, serverHost || "", conversationId, summary.thread_id);
    socket.emit("thread:fetch", { conversationId, threadId: summary.thread_id });
  }, [socketConnection, conversationId, serverHost]);

  const closeThread = useCallback(() => {
    setOpenThread(serverHost || "", null);
    forgetOpenThread();
    setOpen(null);
  }, [serverHost]);

  /** Ask for the open thread again, after the panel drew a refusal. */
  const retryFetch = useCallback(() => {
    const socket = asSocket(socketConnection);
    const cur = openRef.current;
    if (!socket || !cur) return;
    setOpen((o) => (o ? { ...o, loading: true, error: null } : o));
    socket.emit("thread:fetch", { conversationId, threadId: cur.thread.thread_id });
  }, [socketConnection, conversationId]);

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
          returnDraft(draftKey(serverHost || "", conversationId, cur.thread.thread_id), { text: trimmed, files });
          return;
        }
      }
      const payload = {
        conversationId,
        threadId: cur.thread.thread_id,
        text: trimmed,
        attachments: fileIds,
        replyToMessageId,
        nonce,
      };
      retryQueueRef.current.set(nonce, { payload, files, retryCount: 0, returnTo: draftKey(serverHost || "", conversationId, cur.thread.thread_id) });
      if (queueRef.current) queueRef.current.add(nonce);
      else failReply(nonce);
    })();
  }, [socketConnection, conversationId, serverHost, currentUserId, currentUserNickname, failReply]);

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

  return { summaries, open, startThread, openThread, openSummary, closeThread, retryFetch, sendReply, setTags, setStatus, loadOlder };
}
