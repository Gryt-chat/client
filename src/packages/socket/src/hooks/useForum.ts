import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import { getServerAccessToken } from "@/common";

/**
 * A forum channel's topic index. Topics are the threads in the channel; this
 * hook fetches them as summary rows and creates new ones. It refetches when a
 * thread is created, updated or deleted so the list stays live without holding
 * every topic's messages. GRYT-981 Stage 2.
 */

export interface ForumTopic {
  thread_id: string;
  conversation_id: string;
  root_message_id: string;
  title: string | null;
  status: "open" | "solved" | "closed";
  reply_count: number;
  participant_count: number;
  created_at: string;
  last_message_at: string;
  creator_server_id: string;
  creator_nickname: string | null;
  creator_avatar_file_id: string | null;
  preview: string | null;
}

export type ForumFilter = "all" | "unanswered" | "solved" | "mine";

interface ForumSocket {
  emit: (event: string, data: unknown) => void;
  on: (event: string, cb: (payload: never) => void) => void;
  off: (event: string, cb: (payload: never) => void) => void;
}

function asSocket(s: unknown): ForumSocket | null {
  if (!s || typeof s !== "object") return null;
  const c = s as Partial<ForumSocket>;
  return typeof c.emit === "function" && typeof c.on === "function" && typeof c.off === "function"
    ? (c as ForumSocket)
    : null;
}

export interface UseForumResult {
  topics: ForumTopic[];
  loading: boolean;
  createTopic: (title: string, text: string) => void;
}

export function useForum(
  socketConnection: unknown,
  conversationId: string,
  serverHost: string | undefined,
): UseForumResult {
  const [topics, setTopics] = useState<ForumTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = asSocket(socketConnection);
    if (!socket || !conversationId) return;
    let alive = true;

    const refetch = () => socket.emit("forum:topics", { conversationId });
    const scheduleRefetch = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(refetch, 250);
    };

    const onList = (p: { conversation_id: string; topics: ForumTopic[] }) => {
      if (!alive || p.conversation_id !== conversationId) return;
      setTopics(p.topics ?? []);
      setLoading(false);
    };
    const onThreadEvent = (p: { conversation_id?: string }) => {
      if (p?.conversation_id === conversationId) scheduleRefetch();
    };
    const onError = (e: { message?: string } | string) => {
      const message = typeof e === "string" ? e : e?.message;
      if (message) toast.error(message);
    };

    socket.on("forum:topics:list", onList as (p: never) => void);
    socket.on("thread:created", onThreadEvent as (p: never) => void);
    socket.on("thread:updated", onThreadEvent as (p: never) => void);
    socket.on("thread:deleted", onThreadEvent as (p: never) => void);
    socket.on("forum:error", onError as (p: never) => void);

    setLoading(true);
    refetch();

    return () => {
      alive = false;
      if (debounce.current) clearTimeout(debounce.current);
      socket.off("forum:topics:list", onList as (p: never) => void);
      socket.off("thread:created", onThreadEvent as (p: never) => void);
      socket.off("thread:updated", onThreadEvent as (p: never) => void);
      socket.off("thread:deleted", onThreadEvent as (p: never) => void);
      socket.off("forum:error", onError as (p: never) => void);
    };
  }, [socketConnection, conversationId]);

  const createTopic = useCallback((title: string, text: string) => {
    const socket = asSocket(socketConnection);
    const accessToken = getServerAccessToken(serverHost || "");
    if (!socket || !accessToken) return;
    socket.emit("forum:topic:create", { conversationId, title: title.trim(), text: text.trim(), accessToken });
  }, [socketConnection, conversationId, serverHost]);

  return { topics, loading, createTopic };
}
