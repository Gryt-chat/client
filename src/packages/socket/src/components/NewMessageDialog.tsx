import { Avatar, Button, Checkbox, Dialog, IconButton, Spinner, Tabs } from "@gryt/ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { getOwnServerUserId, getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { PiXBold } from "../../../../lib/icons";
import { useDirectory, useDmsOffHosts } from "../hooks/dmDirectory";
import { requestConversation } from "../hooks/dmSpace";
import { setNewMessageOpen, useNewMessageOpen } from "../hooks/newMessageDialog";
import { conversationTitle } from "../hooks/useDirectMessages";
import { canOnServer } from "../hooks/usePermissions";
import { useReachable } from "../hooks/useReachable";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import {
  type Candidate,
  candidatesFor,
  createdGroup,
  directWith,
  matching,
  type NewMessageMode,
} from "../lib/newMessage";
import { emitAuthenticated } from "../utils/tokenManager";
import { EmojiText } from "./EmojiText";
import { GroupFaceFields } from "./GroupDialog";
import { statusConfig } from "./memberStatus";
import { PresenceDot } from "./PresenceDot";

/**
 * The + next to Messages: somebody on any of your servers, or a group on one of them.
 * Mounted once above the server view, which a conversation on another server moves.
 */

/** Long enough for a slow server, short enough that a dead one doesn't look like a hang. */
const ANSWER_MS = 10_000;

type Waiting =
  | { kind: "dm"; host: string; serverUserId: string }
  | { kind: "group"; host: string; picked: string[]; before: ReadonlySet<string> };

function noOneText(s: { canMessageSomewhere: boolean; groupBlocked: boolean; nobody: boolean; query: string }): string {
  if (!s.canMessageSomewhere) return "None of your servers let you start a conversation.";
  if (s.groupBlocked) return "None of your servers let you start a group.";
  return s.nobody ? "There\u2019s nobody else on your servers yet." : `Nobody matches \u201c${s.query}\u201d.`;
}

export function NewMessageDialog() {
  const open = useNewMessageOpen();
  const { sockets, memberLists, serverDetailsList, serverConnectionStatus } = useSockets();
  const { servers, currentlyViewingServer, viewServerBehindDmSpace } = useServerManagement();
  const entries = useDirectory();
  const dmsOff = useDmsOffHosts();

  const [mode, setMode] = useState<NewMessageMode>("message");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  /** The server a group goes on, fixed by the first person picked. */
  const [groupHost, setGroupHost] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The group just made, once the server has sent it: the name and picture step. */
  const [made, setMade] = useState<{ host: string; conversationId: string } | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const sentName = useRef("");

  useEffect(() => {
    if (!open) return;
    setMode("message");
    setQuery("");
    setPicked([]);
    setGroupHost(null);
    setWaiting(null);
    setProblem(null);
    setMade(null);
    setName("");
    setIcon(null);
    sentName.current = "";
  }, [open]);

  const reachable = useReachable(open);

  const serverName = (host: string) => servers[host]?.name || host;

  const people = useMemo(
    () =>
      Object.keys(sockets)
        .filter((host) => sockets[host] && serverConnectionStatus[host] === "connected")
        .map((host) => {
          const info = serverDetailsList[host]?.server_info;
          return {
            host,
            selfId: getOwnServerUserId(host),
            members: memberLists[host] ?? [],
            canMessage: canOnServer(info, "send_direct_messages") && !dmsOff.has(host),
            canGroup: canOnServer(info, "create_groups"),
            reachable: reachable[host],
          };
        }),
    [sockets, serverConnectionStatus, serverDetailsList, memberLists, dmsOff, reachable],
  );

  const everyone = useMemo(() => candidatesFor(people, mode), [people, mode]);
  const shown = matching(everyone, query, serverName);
  const canGroupSomewhere = people.some((p) => p.canMessage && p.canGroup);
  const canMessageSomewhere = people.some((p) => p.canMessage);

  /* The same way a row in the list opens one. A conversation on another server moves
     the view underneath to it, and the view claims the conversation when it gets there. */
  const show = (host: string, conversationId: string) => {
    requestConversation(host, conversationId);
    if (host !== currentlyViewingServer?.host) viewServerBehindDmSpace(host);
  };

  /* The answer is the conversation turning up in the directory: neither `dm:open` nor
     `dm:group:create` replies to the one who asked with anything else. */
  useEffect(() => {
    if (!waiting) return;
    if (waiting.kind === "dm") {
      const found = directWith(entries, waiting.host, waiting.serverUserId);
      if (!found) return;
      setWaiting(null);
      show(waiting.host, found.conversation_id);
      setNewMessageOpen(false);
      return;
    }
    const found = createdGroup(entries, waiting.host, waiting.before, waiting.picked);
    if (!found) return;
    setWaiting(null);
    show(waiting.host, found.conversation_id);
    setMade({ host: waiting.host, conversationId: found.conversation_id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, entries]);

  /* A refusal is toasted where it arrives. Here it only stops the wait, so what was
     picked is still picked when it clears. */
  useEffect(() => {
    if (!waiting) return;
    const host = waiting.host;
    const socket = sockets[host];
    if (!socket) return;
    const stop = () => setWaiting(null);
    const refused = (payload: { error?: string } | undefined) => {
      if (payload?.error === "forbidden" || payload?.error === "rate_limited") stop();
    };
    socket.on("dm:error", stop);
    socket.on("server:error", refused);
    const timer = setTimeout(() => {
      stop();
      setProblem(`${serverName(host)} didn’t answer. Try again in a moment.`);
    }, ANSWER_MS);
    return () => {
      socket.off("dm:error", stop);
      socket.off("server:error", refused);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, sockets]);

  const message = (candidate: Candidate) => {
    setProblem(null);
    const existing = directWith(entries, candidate.host, candidate.serverUserId);
    if (existing) {
      show(candidate.host, existing.conversation_id);
      setNewMessageOpen(false);
      return;
    }
    const socket = sockets[candidate.host];
    if (!socket) return;
    setWaiting({ kind: "dm", host: candidate.host, serverUserId: candidate.serverUserId });
    void emitAuthenticated(socket, "dm:open", { targetServerUserId: candidate.serverUserId }, candidate.host)
      .then((sent) => {
        if (sent) return;
        setWaiting(null);
        setProblem(`You’re not signed in to ${serverName(candidate.host)}.`);
      });
  };

  const toggle = (candidate: Candidate) => {
    const next = picked.includes(candidate.serverUserId)
      ? picked.filter((id) => id !== candidate.serverUserId)
      : [...picked, candidate.serverUserId];
    setPicked(next);
    setGroupHost(next.length > 0 ? candidate.host : null);
  };

  const createGroup = () => {
    if (!groupHost || picked.length < 2) return;
    const socket = sockets[groupHost];
    if (!socket) return;
    setProblem(null);
    const before = new Set(
      entries.filter((e) => e.host === groupHost).map((e) => e.conversation.conversation_id),
    );
    setWaiting({ kind: "group", host: groupHost, picked, before });
    void emitAuthenticated(socket, "dm:group:create", { memberIds: picked }, groupHost).then((sent) => {
      if (sent) return;
      setWaiting(null);
      setProblem(`You’re not signed in to ${serverName(groupHost)}.`);
    });
  };

  const madeGroup = made
    ? entries.find((e) => e.host === made.host && e.conversation.conversation_id === made.conversationId)
      ?.conversation
    : undefined;

  const update = (changes: { name?: string | null; iconFileId?: string | null }) => {
    const socket = made ? sockets[made.host] : undefined;
    if (!made || !socket) return;
    void emitAuthenticated(socket, "dm:group:update", { conversationId: made.conversationId, ...changes }, made.host);
  };

  /* Sent when the field is left, and on the way out, so closing never loses a name. */
  const sendName = () => {
    const trimmed = name.trim();
    if (trimmed === sentName.current) return;
    sentName.current = trimmed;
    update({ name: trimmed || null });
  };

  /* Cancelling while a server is still answering drops the answer, or the
     conversation would open by itself after the dialog had gone. */
  const close = () => {
    if (made) sendName();
    setWaiting(null);
    setNewMessageOpen(false);
  };

  const statusLine = (candidate: Candidate) => {
    const where = serverName(candidate.host);
    // In a group, somebody on another server can't join this one, so say why they're greyed.
    if (mode === "group" && groupHost && candidate.host !== groupHost) return `${where} \u00b7 not on ${serverName(groupHost)}`;
    const quiet = candidate.status === "afk" || candidate.status === "offline";
    return quiet && candidate.status ? `${where} \u00b7 ${statusConfig[candidate.status].label}` : where;
  };

  const face = (candidate: Candidate) => (
    <span className="relative inline-flex shrink-0">
      <Avatar
        size="small"
        fallback={candidate.nickname[0]}
        src={resolveAvatarSrc(
          candidate.avatarFileId
            ? getUploadsFileUrl(candidate.host, candidate.avatarFileId, { thumb: true })
            : undefined,
          candidate.nickname,
          candidate.avatarWorn,
        )}
      />
      {candidate.status && (
        <span className="absolute rounded-(--gryt-radius-full)" style={{ bottom: -1, right: -1, padding: 2, background: "var(--gryt-neutral-2)" }}>
          <PresenceDot status={candidate.status} size={8} />
        </span>
      )}
    </span>
  );

  const row = (candidate: Candidate) => {
    const key = `${candidate.host}/${candidate.serverUserId}`;
    const label = (
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-semibold"><EmojiText text={candidate.nickname} /></span>
        <span className="truncate text-xs" style={{ color: "var(--gryt-neutral-10)" }}>{statusLine(candidate)}</span>
      </span>
    );

    if (mode === "group") {
      const checked = picked.includes(candidate.serverUserId) && candidate.host === groupHost;
      const elsewhere = groupHost !== null && candidate.host !== groupHost;
      return (
        <label
          key={key}
          className="flex items-center gap-3 rounded-(--gryt-radius-lg) px-2.5 py-2"
          style={{
            background: checked ? "var(--gryt-neutral-3)" : undefined,
            cursor: elsewhere ? "default" : "pointer",
            opacity: elsewhere ? 0.45 : 1,
          }}
        >
          <Checkbox checked={checked} disabled={waiting !== null || elsewhere} onCheckedChange={() => toggle(candidate)} />
          {face(candidate)}
          {label}
        </label>
      );
    }

    const asking = waiting?.kind === "dm" && waiting.host === candidate.host
      && waiting.serverUserId === candidate.serverUserId;
    return (
      <Button
        key={key}
        tone="ghost"
        disabled={waiting !== null}
        style={{ width: "100%", justifyContent: "start", overflow: "hidden", gap: "12px", height: "auto", padding: "8px 10px" }}
        onClick={() => message(candidate)}
      >
        {face(candidate)}
        {label}
        {asking && <Spinner size={14} aria-label="Opening the conversation" />}
      </Button>
    );
  };

  const pickedPeople = groupHost
    ? picked.map((id) => everyone.find((c) => c.host === groupHost && c.serverUserId === id)).filter((c): c is Candidate => !!c)
    : [];

  const emptyText = noOneText({ canMessageSomewhere, groupBlocked: mode === "group" && !canGroupSomewhere, nobody: everyone.length === 0, query });

  const switchTo = (next: NewMessageMode) => {
    setMode(next);
    setPicked([]);
    setGroupHost(null);
    setProblem(null);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          {made ? (
            <>
              <Dialog.Title>Name and picture</Dialog.Title>
              <Dialog.Description>
                Both are optional, and you can change them later in Group settings.
              </Dialog.Description>
              <div className="flex flex-col gap-4">
                <GroupFaceFields
                  serverHost={made.host}
                  seed={name.trim() || (madeGroup ? conversationTitle(madeGroup) : "New group")}
                  icon={icon}
                  onIcon={(fileId) => {
                    setIcon(fileId);
                    update({ iconFileId: fileId });
                  }}
                  name={name}
                  onName={setName}
                  onNameDone={sendName}
                  placeholder={madeGroup ? conversationTitle(madeGroup) : "Optional"}
                  autoFocus
                />
              </div>
              <Dialog.Footer>
                <Button onClick={close}>Done</Button>
              </Dialog.Footer>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Dialog.Title>{mode === "group" ? "New group" : "New message"}</Dialog.Title>
                <Dialog.Close render={<IconButton tone="ghost" size="small" aria-label="Close" />}>
                  <PiXBold size={14} />
                </Dialog.Close>
              </div>

              <div className="flex flex-col gap-3">
                {canGroupSomewhere && (
                  <Tabs value={mode} onValueChange={(v) => switchTo(v as NewMessageMode)}>
                    <Tabs.List aria-label="A message or a group" className="grid w-full grid-cols-2">
                      <Tabs.Tab value="message" disabled={waiting !== null}>Message</Tabs.Tab>
                      <Tabs.Tab value="group" disabled={waiting !== null}>Group</Tabs.Tab>
                      <Tabs.Indicator />
                    </Tabs.List>
                  </Tabs>
                )}

                {/* The people picked sit in the field as chips; Backspace on an empty field takes the last one off. */}
                <div
                  className="flex flex-wrap items-center gap-1.5 rounded-(--gryt-radius-control) px-2 py-1.5"
                  style={{ background: "var(--gryt-neutral-2)", border: "1px solid var(--gryt-neutral-6)" }}
                >
                  {pickedPeople.map((c) => (
                    <span key={c.serverUserId} className="inline-flex items-center gap-1 rounded-(--gryt-radius-full) py-0.5 pl-0.5 pr-1.5 text-sm" style={{ background: "var(--gryt-neutral-4)" }}>
                      <Avatar size="small" style={{ width: 20, height: 20 }} fallback={c.nickname[0]} src={resolveAvatarSrc(c.avatarFileId ? getUploadsFileUrl(c.host, c.avatarFileId, { thumb: true }) : undefined, c.nickname, c.avatarWorn)} />
                      <EmojiText text={c.nickname} />
                      <button type="button" aria-label={`Remove ${c.nickname}`} className="inline-flex cursor-pointer border-0 bg-transparent p-0.5" style={{ color: "var(--gryt-neutral-11)" }} onClick={() => toggle(c)}>
                        <PiXBold size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    autoFocus
                    aria-label="Search people"
                    placeholder="Search people"
                    className="min-w-24 flex-1 border-0 bg-transparent px-1 py-1 text-sm outline-none"
                    style={{ color: "var(--gryt-neutral-12)" }}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && query === "" && pickedPeople.length > 0) toggle(pickedPeople[pickedPeople.length - 1]);
                    }}
                  />
                </div>

                <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                  {shown.length === 0 ? (
                    <p className="px-2 py-1 text-xs" style={{ color: "var(--gryt-neutral-10)" }}>{emptyText}</p>
                  ) : (
                    shown.map(row)
                  )}
                </div>

                {mode === "group" && (
                  <span className="text-xs text-gryt-muted" style={{ lineHeight: 1.5 }}>
                    {picked.length === 1
                      ? "Pick one more. With only two of you, it\u2019s a direct message."
                      : "Everybody in a group has to be on the same server, so people from other servers can\u2019t be added to this one."}
                  </span>
                )}
                {problem && <span className="text-xs text-gryt-danger">{problem}</span>}
              </div>

              {mode === "group" && (
                <Dialog.Footer className="items-center justify-between">
                  <span className="text-sm">
                    Name and picture <span className="text-gryt-muted">&middot; Optional</span>
                  </span>
                  <Button onClick={createGroup} disabled={picked.length < 2 || waiting !== null}>
                    {waiting?.kind === "group" ? "Creating\u2026" : "Create group"}
                  </Button>
                </Dialog.Footer>
              )}
            </>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
