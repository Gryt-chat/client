import { useCallback } from "react";

import { getDirectorySnapshot } from "./dmDirectory";
import { type DmSpaceOrigin, lastConversation, requestConversation, setDmSpaceOpen, wayBack } from "./dmSpace";
import { useServerManagement } from "./useServerManagement";

/* Opening the space from the rail puts you back where you were. One place, so the
   rail's button and the phone's cannot disagree about it. GRYT-1146. */
export function useOpenDmSpace(): () => void {
  const { currentlyViewingServer, showDiscovery, setShowDiscovery, viewServerBehindDmSpace } = useServerManagement();
  const host = currentlyViewingServer?.host ?? null;

  return useCallback(() => {
    /* Taken before anything moves: restoring a conversation below changes the server
       underneath, and this is what the button goes back to. GRYT-1148. */
    const from: DmSpaceOrigin | null = showDiscovery
      ? { kind: "discovery" }
      : host ? { kind: "server", host } : null;

    const was = lastConversation();
    /* Only one somebody has written in. An empty one drops out of the list when
       you leave, and bringing it back would undo that. */
    const stillThere = was && getDirectorySnapshot().some(
      (entry) =>
        entry.host === was.host
        && entry.conversation.conversation_id === was.conversationId
        && entry.conversation.last_message_at !== null,
    );
    if (was && stillThere) {
      requestConversation(was.host, was.conversationId);
      viewServerBehindDmSpace(was.host);
    }
    // Left rather than kept lit underneath, the way picking a server leaves it.
    setShowDiscovery(false);
    setDmSpaceOpen(true, from);
  }, [host, showDiscovery, setShowDiscovery, viewServerBehindDmSpace]);
}

/* The button again, from inside: back to what was on screen when you went in, the
   same server on the channel you left. Sivert: "takes me back to where I was". */
export function useLeaveDmSpace(): () => void {
  const { servers, currentlyViewingServer, switchToServer, setShowDiscovery } = useServerManagement();
  const underneath = currentlyViewingServer?.host ?? null;

  return useCallback(() => {
    const to = wayBack(servers, underneath);
    if (to?.kind === "discovery") {
      setDmSpaceOpen(false);
      setShowDiscovery(true);
    } else if (to) {
      switchToServer(to.host);
    } else {
      setDmSpaceOpen(false);
    }
  }, [servers, underneath, switchToServer, setShowDiscovery]);
}
