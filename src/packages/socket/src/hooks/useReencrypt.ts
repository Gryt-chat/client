import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { getServerAccessToken, openLocalArchive } from "@/common";

import { reencryptMine } from "../mls/reencrypt";
import type { MlsSource } from "../mls/serverMls";
import type { HistoryPayload } from "./chatEventHandlers";

const FETCH_TIMEOUT_MS = 15_000;
const PAGE = 100;

function fetchOlder(socket: Socket, conversationId: string, before: string | undefined): Promise<{ items: HistoryPayload["items"]; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      socket.off("chat:history", onHistory);
      reject(new Error("The server didn’t send the older messages."));
    }, FETCH_TIMEOUT_MS);
    function onHistory(payload: HistoryPayload) {
      if (payload?.conversation_id !== conversationId || (payload.before ?? undefined) !== before) return;
      window.clearTimeout(timer);
      socket.off("chat:history", onHistory);
      resolve({ items: payload.items ?? [], hasMore: !!payload.hasMore });
    }
    socket.on("chat:history", onHistory);
    socket.emit("chat:fetch", { conversationId, limit: PAGE, ...(before ? { before } : {}) });
  });
}

export function useReencrypt({ host, socket, source, me, conversationId, peer }: {
  host: string | undefined;
  socket: Socket | null;
  source: MlsSource | null | undefined;
  me: string | undefined;
  conversationId: string | undefined;
  peer: string | undefined;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const stopped = useRef(false);

  const start = useCallback(async () => {
    if (!host || !socket || !source || !me || !conversationId || !peer) return;
    const token = getServerAccessToken(host);
    if (!token) return;
    stopped.current = false;
    setProgress({ done: 0, total: 0 });
    try {
      const done = await reencryptMine({
        source,
        archive: (await openLocalArchive()).messages,
        fetchOlder: (before) => fetchOlder(socket, conversationId, before),
        remove: (messageId) => socket.emit("chat:delete", { conversationId, messageId, accessToken: token }),
        sleep: (ms) => new Promise((r) => window.setTimeout(r, ms)),
        stopped: () => stopped.current,
        report: (d, total) => setProgress({ done: d, total }),
      }, me, conversationId, peer);
      toast.success(done ? `Encrypted ${done} of your older messages` : "You have no older text messages to encrypt here");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Encrypting stopped. Nothing unsent was removed.");
    } finally {
      setProgress(null);
    }
  }, [host, socket, source, me, conversationId, peer]);

  return { progress, start };
}
