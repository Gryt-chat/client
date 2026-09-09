import { conversationTitle, type DirectConversation } from "@gryt/core";
import { Button, TextField } from "@gryt/ui";
import { useMemo, useState } from "react";

import { useDirectory } from "../hooks/dmDirectory";
import { requestConversation, setDmSpaceOpen } from "../hooks/dmSpace";
import { useDirectoryUnread } from "../hooks/useDirectoryUnread";
import { useServerManagement } from "../hooks/useServerManagement";
import { DmSpaceList } from "./DmSpaceList";

/**
 * Every direct conversation, on every server, in one place. The first screen in
 * Gryt that is not scoped to a single server (GRYT-1134).
 */

function Empty() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col gap-3" style={{ maxWidth: "42ch" }}>
        <h2 className="text-lg" style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
          You haven&rsquo;t messaged anyone yet.
        </h2>
        <p className="text-sm" style={{ color: "var(--gryt-neutral-11)", lineHeight: 1.6 }}>
          Direct conversations start from a server. Open one, click somebody in the
          member list, and it appears here.
        </p>
        <p className="text-sm" style={{ color: "var(--gryt-neutral-11)", lineHeight: 1.6 }}>
          Every conversation belongs to the server you started it on, and messaging the
          same person somewhere else starts a separate one.
        </p>
      </div>
    </div>
  );
}

export function DirectMessagesSpace() {
  const entries = useDirectory();
  const { countFor } = useDirectoryUnread();
  const { servers, switchToServer } = useServerManagement();
  const [selected, setSelected] = useState<{ host: string; conversationId: string } | null>(null);
  const [query, setQuery] = useState("");

  /* Matched on the name and on the server, since the server is the thing that
     tells two rows with one name apart. */
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => {
      const name = conversationTitle(entry.conversation).toLowerCase();
      const server = (servers[entry.host]?.name || entry.host).toLowerCase();
      return name.includes(needle) || server.includes(needle);
    });
  }, [entries, query, servers]);

  /* Handed to the server it belongs to, which already holds the connection and
     the keys. The space is the way in, not a second copy of the reader. */
  function open(host: string, conversation: DirectConversation) {
    setSelected({ host, conversationId: conversation.conversation_id });
    requestConversation(host, conversation.conversation_id);
    switchToServer(host);
    setDmSpaceOpen(false);
  }

  return (
    <div
      className="flex flex-1 overflow-hidden rounded-(--gryt-radius-lg)"
      style={{ border: "1px solid var(--gryt-neutral-6)", background: "var(--gryt-neutral-1)" }}
    >
      <aside
        className="flex flex-col"
        style={{
          width: 300, flex: "0 0 300px",
          background: "var(--gryt-neutral-2)",
          borderRight: "1px solid var(--gryt-neutral-3)",
        }}
      >
        <div className="flex items-baseline justify-between px-4 pb-3 pt-4">
          <h1 className="text-lg" style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
            Messages
          </h1>
        </div>

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
            selected={selected}
            unreadFor={countFor}
            onOpen={open}
          />
        )}
      </aside>

      {entries.length === 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex flex-col gap-3" style={{ maxWidth: "40ch" }}>
            <p className="text-sm" style={{ color: "var(--gryt-neutral-11)", lineHeight: 1.6 }}>
              Pick a conversation. It opens on the server it belongs to, which is the one
              holding its keys.
            </p>
            {Object.keys(servers).length > 1 && (
              <p className="text-xs" style={{ color: "var(--gryt-neutral-10)", lineHeight: 1.6 }}>
                The same name can appear twice. Two servers means two conversations, and
                nothing here can tell you whether they are the same person.
              </p>
            )}
            <span>
              <Button size="small" tone="ghost" onClick={() => setSelected(null)}>
                Clear selection
              </Button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
