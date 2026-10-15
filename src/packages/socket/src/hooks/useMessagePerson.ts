import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { directWith } from "../lib/newMessage";
import { emitAuthenticated } from "../utils/tokenManager";
import { useDirectory } from "./dmDirectory";
import { requestConversation } from "./dmSpace";
import { useServerManagement } from "./useServerManagement";
import { useSockets } from "./useSockets";

/** How long to wait for `dm:opened` before saying the server didn't answer. */
const ANSWER_MS = 10_000;

/**
 * Open your conversation with somebody from anywhere in the messages space: the
 * existing one if there is one, otherwise `dm:open` and wait for it to be listed.
 */
export function useMessagePerson(): (host: string, serverUserId: string) => void {
  const entries = useDirectory();
  const { sockets } = useSockets();
  const { currentlyViewingServer, viewServerBehindDmSpace } = useServerManagement();
  const [waiting, setWaiting] = useState<{ host: string; serverUserId: string } | null>(null);

  const show = useCallback((host: string, conversationId: string) => {
    requestConversation(host, conversationId);
    if (host !== currentlyViewingServer?.host) viewServerBehindDmSpace(host);
  }, [currentlyViewingServer?.host, viewServerBehindDmSpace]);

  // `dm:open` answers nobody but the directory, so the conversation turning up there is the reply.
  useEffect(() => {
    if (!waiting) return;
    const found = directWith(entries, waiting.host, waiting.serverUserId);
    if (!found) return;
    setWaiting(null);
    show(waiting.host, found.conversation_id);
  }, [waiting, entries, show]);

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setWaiting(null);
      toast.error("The server didn’t answer. Try again in a moment.");
    }, ANSWER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  return useCallback((host: string, serverUserId: string) => {
    const existing = directWith(entries, host, serverUserId);
    if (existing) return show(host, existing.conversation_id);
    const socket = sockets[host];
    if (!socket) return;
    setWaiting({ host, serverUserId });
    void emitAuthenticated(socket, "dm:open", { targetServerUserId: serverUserId }, host).then((sent) => {
      if (sent) return;
      setWaiting(null);
      toast.error("You’re not signed in to that server.");
    });
  }, [entries, sockets, show]);
}
