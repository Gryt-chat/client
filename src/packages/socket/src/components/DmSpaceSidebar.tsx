import { conversationTitle, type DirectConversation } from "@gryt/core";
import { Badge, Button, IconButton, Tabs, TextField, Tooltip } from "@gryt/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import { getOwnServerUserId, getServerAccessToken } from "@/common";

import { PiCaretDownFill, PiCaretRightFill, PiPlus, PiShieldCheckFill, PiSidebarSimpleFill } from "../../../../lib/icons";
import { admitConversation, dismissFiltered, type FilteredItem } from "../hooks/contactFilterStore";
import { type DirectoryEntry,listedConversations, useDirectory } from "../hooks/dmDirectory";
import { pinFor, reorderPins, usePins } from "../hooks/dmPins";
import { requestConversation, useVisitingConversation, visitConversation } from "../hooks/dmSpace";
import { useAllFriends } from "../hooks/friendsStore";
import {
  setHiddenExpanded,
  showConversation,
  splitHidden,
  useHiddenConversations,
  useHiddenExpanded,
} from "../hooks/hiddenConversations";
import { setNewMessageOpen } from "../hooks/newMessageDialog";
import { useConversationPreviews } from "../hooks/useConversationPreviews";
import { useDirectoryUnread } from "../hooks/useDirectoryUnread";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import { DmSpaceList } from "./DmSpaceList";
import { FilteredContacts } from "./FilteredContacts";
import { FriendsPanel } from "./FriendsPanel";
import { hideConversationWithUndo, useConfirmHide } from "./hideConversation";

function sidebarPanel(friends: boolean, listed: number, matched: number) {
  if (friends) return "friends";
  if (listed === 0) return "empty";
  return matched === 0 ? "no-match" : "list";
}

/**
 * The conversation list, in place of the channel sidebar. Every server's, not
 * this one's: it is the only column in Gryt that crosses servers (GRYT-1134).
 */
export function DmSpaceSidebar({
  host, selectedConversationId, onOpen, onHidden, fill = false, listPinned, onToggleList,
}: {
  /** The server currently rendered beside this, so a row on it opens directly. */
  host: string;
  selectedConversationId: string | null;
  onOpen: (conversation: { conversation_id: string }) => void;
  /** Told when a row on this server is hidden, so the view can let go of it. */
  onHidden?: (conversationId: string) => void;
  /** The whole of what it's in, for the phone's sheet and the tiny window, rather than a 300px column. */
  fill?: boolean;
  /** Whether the list stays open, or folds to a grip that opens on hover (board 19). */
  listPinned?: boolean;
  onToggleList?: () => void;
}) {
  const entries = useDirectory();
  const { countFor } = useDirectoryUnread();
  const { servers, viewServerBehindDmSpace } = useServerManagement();
  const [query, setQuery] = useState("");
  const friends = useAllFriends();
  // Requests and friends the server lists that this device never added: both wait on you.
  const waitingOnYou = friends.reduce((n, h) => n + h.incoming.length + h.friends.filter((f) => !f.confirmed).length, 0);
  const [tab, setTab] = useState<"chats" | "friends">("chats");
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

  /* Pinned rows on top in the order they were dragged into, the rest by recent activity. */
  const pins = usePins();
  const { pinned, unpinned } = useMemo(() => {
    const order = new Map(pins.map((p, i) => [JSON.stringify([p.host, p.serverUserId, p.conversationId]), i]));
    const at = (e: DirectoryEntry) => order.get(JSON.stringify(Object.values(pinFor(e))));
    const pinned = matching.shown.filter((e) => at(e) !== undefined).sort((a, b) => (at(a) ?? 0) - (at(b) ?? 0));
    return { pinned, unpinned: matching.shown.filter((e) => at(e) === undefined) };
  }, [matching.shown, pins]);

  const previews = useConversationPreviews(listed);

  /* A 1:1 whose name is on another row names its server: the client can't tell
     whether two people with one name are one person (GRYT-1134). */
  const clashes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const e of listed) if (e.conversation.kind === "dm") seen.set(conversationTitle(e.conversation), (seen.get(conversationTitle(e.conversation)) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [listed]);

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

  const [askHide, hideDialog] = useConfirmHide();
  function hide(entry: DirectoryEntry) {
    askHide(conversationTitle(entry.conversation), () => hideNow(entry));
  }

  function hideNow(entry: DirectoryEntry) {
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

  /* A filtered conversation may not be in the list yet, since its arrival was
     dropped. Ask that server for its list again and open it when it lands. */
  const { sockets } = useSockets();
  const [pendingFiltered, setPendingFiltered] = useState<{ host: string; conversationId: string } | null>(null);
  function openFiltered(item: FilteredItem) {
    admitConversation(item.host, item.conversationId);
    dismissFiltered(item.host, item.conversationId);
    const found = entries.find((e) => e.host === item.host && e.conversation.conversation_id === item.conversationId);
    if (found) {
      open(found.host, found.conversation);
      return;
    }
    setPendingFiltered({ host: item.host, conversationId: item.conversationId });
    sockets[item.host]?.emit("dm:list", { accessToken: getServerAccessToken(item.host) });
  }
  useEffect(() => {
    if (!pendingFiltered) return;
    const found = entries.find(
      (e) => e.host === pendingFiltered.host && e.conversation.conversation_id === pendingFiltered.conversationId,
    );
    if (!found) return;
    setPendingFiltered(null);
    open(found.host, found.conversation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, pendingFiltered]);

  const selected = selectedConversationId ? { host, conversationId: selectedConversationId } : null;

  const panel = sidebarPanel(tab === "friends", listed.length, matching.shown.length + matching.shownHidden.length);

  return (
    <aside
      data-gryt="dm-list"
      className={`flex shrink-0 flex-col overflow-hidden${fill ? "" : " rounded-(--gryt-radius-lg)"}`}
      style={{ width: fill ? "100%" : 320, height: fill ? "100%" : undefined, background: "var(--gryt-neutral-2)" }}
    >
      <div className={`flex items-center gap-1.5 pb-2 pr-3.5 pt-3.5 ${onToggleList ? "pl-2.5" : "pl-4"}`}>
        {onToggleList && (
          <Tooltip title={listPinned ? "Hide messages" : "Keep messages open"}>
            <IconButton
              tone="ghost"
              size="small"
              aria-label={listPinned ? "Hide messages" : "Keep messages open"}
              aria-pressed={!listPinned}
              data-gryt="dm-list-toggle"
              onClick={onToggleList}
            >
              <PiSidebarSimpleFill size={17} />
            </IconButton>
          </Tooltip>
        )}
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>Messages</h1>
        <Button
          size="small"
          className="ml-auto"
          aria-label="New message"
          onClick={() => setNewMessageOpen(true)}
        >
          <PiPlus size={15} />
          New
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "chats" | "friends")} className="px-3.5 pb-2.5">
        <Tabs.List aria-label="Messages or friends" className="grid w-full grid-cols-2">
          <Tabs.Tab value="chats" data-gryt="chats-tab">Chats</Tabs.Tab>
          <Tabs.Tab
            value="friends"
            data-gryt="friends-open"
            aria-label={waitingOnYou > 0 ? `Friends, ${waitingOnYou} waiting` : "Friends"}
          >
            <span className="inline-flex items-center gap-1.5">
              Friends
              {waitingOnYou > 0 && (
                <span data-gryt="friends-waiting" className="pointer-events-none inline-flex">
                  <Badge badgeContent={waitingOnYou} tone="unread" />
                </span>
              )}
            </span>
          </Tabs.Tab>
          <Tabs.Indicator />
        </Tabs.List>
      </Tabs>

      <div className="px-3.5 pb-1.5">
        <TextField
          size="small"
          placeholder={tab === "chats" ? "Find a person" : "Find a friend"}
          aria-label={tab === "chats" ? "Find a person" : "Find a friend"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {panel === "friends" && (
        <FriendsPanel query={query} />
      )}
      {panel === "empty" && (
        <p className="px-4 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
          No conversations yet.
        </p>
      )}
      {panel === "no-match" && (
        <p className="px-4 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>
          Nothing matches &ldquo;{query}&rdquo;.
        </p>
      )}
      {panel === "list" && (
        <div className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
          {pinned.length > 0 && (
            <>
              <div className="flex items-center px-3 pb-1.5 pt-3.5 text-xs font-semibold text-gryt-muted">
                Pinned
                <span className="ml-auto font-normal">Drag to reorder</span>
              </div>
              <DmSpaceList
                entries={pinned}
                selected={selected}
                unreadFor={countFor}
                onOpen={open}
                onHide={hide}
                previews={previews}
                clashes={clashes}
                reorder={(order) => reorderPins(order.map(pinFor))}
              />
              <div className="px-3 pb-1.5 pt-3.5 text-xs font-semibold text-gryt-muted">Messages</div>
            </>
          )}
          <DmSpaceList
            entries={unpinned}
            selected={selected}
            unreadFor={countFor}
            onOpen={open}
            onHide={hide}
            previews={previews}
            clashes={clashes}
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
                      previews={previews}
                      clashes={clashes}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      )}

      {tab === "chats" && listed.length > 0 && (
        <p
          className="mt-auto flex items-center gap-1.5 border-t border-gryt-border px-4.5 pb-3.5 pt-2.5 text-xs text-gryt-muted"
        >
          <PiShieldCheckFill size={12} aria-hidden />
          Previews come from this device&rsquo;s history
        </p>
      )}

      <FilteredContacts onOpen={openFiltered} />
      {hideDialog}
    </aside>
  );
}
