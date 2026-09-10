import { useEffect, useRef } from "react";

import { readLastView, writeLastView } from "@/settings/src/hooks/lastView";

import { getDirectorySnapshot } from "./dmDirectory";
import { rememberConversation, requestConversation, setDmSpaceOpen, useLastConversation } from "./dmSpace";

/* Keeps "where you were" on disk and puts you back there on launch. The server
   underneath is restored by useServerSettings, before this runs. GRYT-1146. */
export function useRememberView({
  ready,
  host,
  dmSpaceOpen,
  showDiscovery,
  setShowDiscovery,
}: {
  /** The user's store has loaded and a server is being viewed. */
  ready: boolean;
  host: string | null;
  dmSpaceOpen: boolean;
  showDiscovery: boolean;
  setShowDiscovery: (show: boolean) => void;
}): void {
  const restored = useRef(false);

  /* Once, first. Writing before reading would record the launch's own default
     and throw away the page that was actually open. */
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;

    const view = readLastView();
    if (!view) return;

    if (view.kind === "discovery") {
      setShowDiscovery(true);
      return;
    }
    if (view.kind === "dm") {
      if (view.conversationId) {
        rememberConversation(view.host, view.conversationId);
        requestConversation(view.host, view.conversationId);
      }
      setDmSpaceOpen(true);
    }
  }, [ready, setShowDiscovery]);

  /* Afterwards, every move. An empty conversation is saved as none, since closing
     Gryt is leaving it, and the list drops those on the way out. */
  const conversation = useLastConversation();
  useEffect(() => {
    if (!ready || !restored.current || !host) return;

    if (showDiscovery) {
      writeLastView({ kind: "discovery" });
      return;
    }
    if (dmSpaceOpen) {
      const written = conversation && getDirectorySnapshot().some(
        (entry) =>
          entry.host === conversation.host
          && entry.conversation.conversation_id === conversation.conversationId
          && entry.conversation.last_message_at !== null,
      );
      writeLastView({
        kind: "dm",
        host: conversation?.host ?? host,
        conversationId: written ? conversation!.conversationId : null,
      });
      return;
    }
    writeLastView({ kind: "server", host });
  }, [ready, host, dmSpaceOpen, showDiscovery, conversation]);
}
