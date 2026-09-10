import { useCallback } from "react";

import { getDirectorySnapshot } from "./dmDirectory";
import { lastConversation, requestConversation, setDmSpaceOpen } from "./dmSpace";
import { useServerManagement } from "./useServerManagement";

/* Opening the space from the rail puts you back where you were. One place, so the
   rail's button and the phone's cannot disagree about it. GRYT-1146. */
export function useOpenDmSpace(): () => void {
  const { viewServerBehindDmSpace } = useServerManagement();

  return useCallback(() => {
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
    setDmSpaceOpen(true);
  }, [viewServerBehindDmSpace]);
}
