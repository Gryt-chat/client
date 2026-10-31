import { type ReencryptCandidate,reencryptMine } from "@gryt/core";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { getServerAccessToken, openLocalArchive } from "@/common";

import { archivedReactions } from "../mls/applyContent";
import type { MlsSource } from "../mls/serverMls";
import type { HistoryPayload } from "./chatEventHandlers";

const FETCH_TIMEOUT_MS = 15_000;
const PAGE = 100;

function fetchOlder(socket: Socket, conversationId: string, before: string | undefined): Promise<{ items: ReencryptCandidate[]; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      socket.off("chat:history", onHistory);
      reject(new Error("The server didn’t send the older messages."));
    }, FETCH_TIMEOUT_MS);
    function onHistory(payload: HistoryPayload) {
      if (payload?.conversation_id !== conversationId || (payload.before ?? undefined) !== before) return;
      window.clearTimeout(timer);
      socket.off("chat:history", onHistory);
      resolve({ items: (payload.items ?? []) as ReencryptCandidate[], hasMore: !!payload.hasMore });
    }
    socket.on("chat:history", onHistory);
    socket.emit("chat:fetch", { conversationId, limit: PAGE, ...(before ? { before } : {}) });
  });
}

const DONE_KEY = "gryt.reencrypted";

function doneHere(id: string): boolean {
  try {
    return !!(JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}") as Record<string, number>)[id];
  } catch {
    return false;
  }
}

function markDone(id: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(DONE_KEY) ?? "{}") as Record<string, number>;
    localStorage.setItem(DONE_KEY, JSON.stringify({ ...all, [id]: Date.now() }));
  } catch {
    // Private mode or a full store: the next open looks again and finds nothing to move.
  }
}

/** Moves this person's old plaintext onto the DM's key once `ready` says that key works. Leaving the DM pauses it. */
export function useReencrypt({ host, socket, source, me, conversationId, peer, ready }: {
  host: string | undefined;
  socket: Socket | null;
  source: MlsSource | null | undefined;
  me: string | undefined;
  conversationId: string | undefined;
  peer: string | undefined;
  ready: boolean;
}): { done: number; total: number } | null {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!ready || !host || !socket || !source || !me || !conversationId || !peer) return;
    const id = `${host}/${conversationId}`;
    const token = getServerAccessToken(host);
    if (!token || doneHere(id)) return;
    let stopped = false;
    void (async () => {
      try {
        const { messages } = await openLocalArchive();
        const moved = await reencryptMine({
          fetchOlder: (before) => fetchOlder(socket, conversationId, before),
          send: async (content) => { await source.send(conversationId, peer, content); },
          keep: (entries, receivedAt) => messages.put(entries.map((e) => ({
            scope: source.storeScope, conversationId, messageId: e.id, sentAt: e.sentAt, senderId: me,
            text: e.text, attachments: {}, sharedBy: me, receivedAt, ...(e.replyTo ? { replyTo: e.replyTo } : {}),
            ...(e.reactions ? { reactions: archivedReactions(e.reactions) } : {}),
          }))),
          now: () => Date.now(),
          newId: () => crypto.randomUUID(),
          remove: (messageId) => socket.emit("chat:delete", { conversationId, messageId, accessToken: token }),
          sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
          stopped: () => stopped,
          report: (done, total) => {
            if (!stopped && total) setProgress({ done, total });
          },
        }, me);
        if (stopped) return;
        markDone(id);
        if (moved) toast.success(`Encrypted ${moved} of your older messages`);
      } catch (e) {
        console.warn("[MLS] Encrypting older messages stopped, and tries again next time", e);
      } finally {
        if (!stopped) setProgress(null);
      }
    })();
    return () => {
      stopped = true;
      setProgress(null);
    };
  }, [ready, host, socket, source, me, conversationId, peer]);

  return progress;
}
