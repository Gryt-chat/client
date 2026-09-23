import { conversationTitle, type DirectConversation } from "@gryt/core";
import { IconButton, TextField, Tooltip } from "@gryt/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { getOwnServerUserId } from "@/common";

import { PiCaretDownFill, PiCaretRightFill, PiPlus } from "../../../../lib/icons";
import { type DirectoryEntry,listedConversations, useDirectory } from "../hooks/dmDirectory";
import { requestConversation, useVisitingConversation, visitConversation } from "../hooks/dmSpace";
import {
  setHiddenExpanded,
  showConversation,
  splitHidden,
  useHiddenConversations,
  useHiddenExpanded,
} from "../hooks/hiddenConversations";
import { setNewMessageOpen } from "../hooks/newMessageDialog";
import { useDirectoryUnread } from "../hooks/useDirectoryUnread";
import { useServerManagement } from "../hooks/useServerManagement";
import { DmSpaceList } from "./DmSpaceList";
import { hideConversationWithUndo } from "./hideConversation";

/**
 * The conversation list, in place of the channel sidebar. Every server's, not
 * this one's: it is the only column in Gryt that crosses servers (GRYT-1134).
 */
export function DmSpaceSidebar({
  host, selectedConversationId, onOpen, onHidden, fill = false,
}: {
  /** The server currently rendered beside this, so a row on it opens directly. */
  host: string;
  selectedConversationId: string | null;
  onOpen: (conversation: { conversation_id: string }) => void;
  /** Told when a row on this server is hidden, so the view can let go of it. */
  onHidden?: (conversationId: string) => void;
  /** The whole of what it's in, for the phone's sheet and the tiny window, rather than a 300px column. */
  fill?: boolean;
}) {
  const entries = useDirectory();
  const { countFor } = useDirectoryUnread();
  const { servers, viewServerBehindDmSpace } = useServerManagement();
  const [query, setQuery] = useState("");
  const reduceMotion = useReducedMotion();

  /* A conversation nobody has written in is listed only while it is the open one,
     so clicking through a member list leaves no rows behind. */
  const visiting = useVisitingConversation();
  const listed = useMemo(() => listedConversations(entries, visiting), [entries, visiting]);

  /* Hidden is this device's answer for this account, so the split has to happen
     here rather than in the store the servers write into. */
  const hiddenAtFor = useHiddenConversations();
  const { listed: visible, hidden, returned } = useMemo(
    () => splitHidden(listed, (rowHost) => hiddenAtFor(rowHost, getOwnServerUserId(rowHost) ?? "")),
    [listed, hiddenAtFor],
  );

  /* A message brought these back, so the note that they were hidden is spent.
     In an effect: the split runs during a render and must not write. */
  useEffect(() => {
    for (const entry of returned) {
      showConversation(entry.host, getOwnServerUserId(entry.host) ?? "", entry.conversation.conversation_id);
    }
  }, [returned]);

  /* Matched on the name and on the server, since the server is what tells two
     rows carrying one name apart. */
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (entry: DirectoryEntry) => {
      const name = conversationTitle(entry.conversation).toLowerCase();
      const server = (servers[entry.host]?.name || entry.host).toLowerCase();
      return name.includes(needle) || server.includes(needle);
    };
    if (!needle) return { shown: visible, shownHidden: hidden };
    return { shown: visible.filter(match), shownHidden: hidden.filter(match) };
  }, [visible, hidden, query, servers]);

  /* Open while the conversation being read is one of the hidden ones, whatever
     this device last chose: a selected row nobody can see is a lost cursor. */
  const chosenExpanded = useHiddenExpanded();
  const selectedIsHidden = hidden.some(
    (entry) => entry.host === host && entry.conversation.conversation_id === selectedConversationId,
  );
  const expanded = chosenExpanded || selectedIsHidden;
  const Caret = expanded ? PiCaretDownFill : PiCaretRightFill;

  /* A row on this server opens here. One on another switches first, and the
     view that arrives claims it. */
  function open(rowHost: string, conversation: DirectConversation) {
    if (rowHost === host) {
      visitConversation(conversation.conversation_id);
      onOpen(conversation);
      return;
    }
    /* Not switchToServer: that is somebody choosing a destination, and it leaves
       the space. This moves the server underneath and stays here. */
    requestConversation(rowHost, conversation.conversation_id);
    viewServerBehindDmSpace(rowHost);
  }

  function hide(entry: DirectoryEntry) {
    const conversationId = entry.conversation.conversation_id;
    hideConversationWithUndo(
      entry.host,
      getOwnServerUserId(entry.host) ?? "",
      conversationId,
      conversationTitle(entry.conversation),
    );
    if (entry.host === host) onHidden?.(conversationId);
  }

  function show(entry: DirectoryEntry) {
    showConversation(entry.host, getOwnServerUserId(entry.host) ?? "", entry.conversation.conversation_id);
  }

  const selected = selectedConversationId ? { host, conversationId: selectedConversationId } : null;

  return (
    <aside
      data-gryt="dm-list"
      className={`flex shrink-0 flex-col overflow-hidden${fill ? "" : " rounded-(--gryt-radius-lg)"}`}
      style={{ width: fill ? "100%" : 300, height: fill ? "100%" : undefined, background: "var(--gryt-neutral-2)" }}
    >
      <div className="flex items-center justify-between gap-2 pb-3 pl-4 pr-3 pt-4">
        <h1 className="text-lg" style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
          Messages
        </h1>
        <Tooltip title="New message">
          <IconButton
            tone="ghost"
            size="xsmall"
            aria-label="New message"
            onClick={() => setNewMessageOpen(true)}
          >
            <PiPlus size={16} />
          </IconButton>
        </Tooltip>
      </div>

      {listed.length > 0 && (
        <div className="px-3 pb-2">
          <TextField
            size="small"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {listed.length === 0 ? (
        <p className="px-4 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
          No conversations yet.
        </p>
      ) : matching.shown.length === 0 && matching.shownHidden.length === 0 ? (
        <p className="px-4 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="flex flex-col overflow-y-auto px-2 pb-2">
          <DmSpaceList
            entries={matching.shown}
            selected={selected}
            unreadFor={countFor}
            onOpen={open}
            onHide={hide}
          />

          {/* No row at all when nothing is hidden: an empty group would be a
              permanent reminder of a feature most people never use. */}
          {matching.shownHidden.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setHiddenExpanded(!expanded)}
                aria-expanded={expanded}
                aria-label={`Hidden, ${matching.shownHidden.length} ${matching.shownHidden.length === 1 ? "conversation" : "conversations"}`}
                className={[
                  "mt-2 flex w-full items-center gap-2 rounded-(--gryt-radius-md) px-2 py-1 text-left",
                  "text-xs font-semibold tracking-wide transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gryt-accent-light",
                  "text-gryt-muted hover:text-gryt-text active:text-gryt-text",
                ].join(" ")}
              >
                <span className="shrink-0">Hidden</span>
                <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-gryt-border" />
                <span aria-hidden="true" className="shrink-0 tabular-nums opacity-70">
                  {matching.shownHidden.length}
                </span>
                <Caret size={10} className="shrink-0" />
              </button>

              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    initial={{ opacity: reduceMotion ? 1 : 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: reduceMotion ? 1 : 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.15 }}
                  >
                    <DmSpaceList
                      entries={matching.shownHidden}
                      selected={selected}
                      unreadFor={countFor}
                      onOpen={open}
                      onShow={show}
                      hidden
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
