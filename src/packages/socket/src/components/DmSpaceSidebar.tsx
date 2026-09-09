import { conversationTitle, type DirectConversation } from "@gryt/core";
import { TextField } from "@gryt/ui";
import { useMemo, useState } from "react";

import { useDirectory } from "../hooks/dmDirectory";
import { requestConversation } from "../hooks/dmSpace";
import { useDirectoryUnread } from "../hooks/useDirectoryUnread";
import { useServerManagement } from "../hooks/useServerManagement";
import { DmSpaceList } from "./DmSpaceList";

/**
 * The conversation list, in place of the channel sidebar. Every server's, not
 * this one's: it is the only column in Gryt that crosses servers (GRYT-1134).
 */
export function DmSpaceSidebar({
  host, selectedConversationId, onOpen,
}: {
  /** The server currently rendered beside this, so a row on it opens directly. */
  host: string;
  selectedConversationId: string | null;
  onOpen: (conversation: { conversation_id: string }) => void;
}) {
  const entries = useDirectory();
  const { countFor } = useDirectoryUnread();
  const { servers, switchToServer } = useServerManagement();
  const [query, setQuery] = useState("");

  /* Matched on the name and on the server, since the server is what tells two
     rows carrying one name apart. */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => {
      const name = conversationTitle(entry.conversation).toLowerCase();
      const server = (servers[entry.host]?.name || entry.host).toLowerCase();
      return name.includes(needle) || server.includes(needle);
    });
  }, [entries, query, servers]);

  /* A row on this server opens here. One on another switches first, and the
     view that arrives claims it. */
  function open(rowHost: string, conversation: DirectConversation) {
    if (rowHost === host) {
      onOpen(conversation);
      return;
    }
    requestConversation(rowHost, conversation.conversation_id);
    switchToServer(rowHost);
  }

  return (
    <aside
      className="flex shrink-0 flex-col overflow-hidden rounded-(--gryt-radius-lg)"
      style={{ width: 300, background: "var(--gryt-neutral-2)" }}
    >
      <h1 className="px-4 pb-3 pt-4 text-lg" style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
        Messages
      </h1>

      {entries.length > 0 && (
        <div className="px-3 pb-2">
          <TextField
            size="small"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {entries.length === 0 ? (
        <p className="px-4 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
          No conversations yet.
        </p>
      ) : shown.length === 0 ? (
        <p className="px-4 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <DmSpaceList
          entries={shown}
          selected={selectedConversationId ? { host, conversationId: selectedConversationId } : null}
          unreadFor={countFor}
          onOpen={open}
        />
      )}
    </aside>
  );
}
