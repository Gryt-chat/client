import { Avatar, Button, ContextMenu, IconButton, Popover } from "@gryt/ui";
import { type ReactNode, useMemo, useState } from "react";

import { getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";

import { PiChatTeardropTextFill } from "../../../../lib/icons";
import { confirmServerFriend, friendAction, useAllFriends } from "../hooks/friendsStore";
import { useMessagePerson } from "../hooks/useMessagePerson";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import type { ServerFriendPerson } from "../utils/friendList";
import { EmojiText } from "./EmojiText";
import { MEMBER_CARD_POPUP } from "./memberCard/memberCardContext";
import { MemberIdentityCard } from "./MemberIdentityCard";
import type { MemberInfo } from "./MemberSidebar";
import { statusConfig } from "./memberStatus";
import { PresenceDot } from "./PresenceDot";
import { ServerMark } from "./ServerChip";

/**
 * The Friends tab of the messages list: requests, then friends, across every
 * server in one list. Each friendship is still one server's, so a row names it.
 */

interface Row {
  host: string;
  person: ServerFriendPerson;
  member?: MemberInfo;
  name: string;
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col">
      <h2 className="flex px-2.5 pb-1 pt-3 text-xs font-semibold text-gryt-muted">
        <span>{title}</span>
        <span className="ml-auto tabular-nums">{count}</span>
      </h2>
      {children}
    </section>
  );
}

export function FriendsPanel({ query }: { query: string }) {
  const all = useAllFriends();
  const { servers } = useServerManagement();
  const { memberLists, serverDetailsList } = useSockets();
  const messagePerson = useMessagePerson();
  const [cardFor, setCardFor] = useState<string | null>(null);

  const rowOf = (host: string, person: ServerFriendPerson): Row => {
    const member = memberLists[host]?.find((m) => m.serverUserId === person.serverUserId);
    return { host, person, member, name: member?.nickname || person.nickname || "Somebody" };
  };

  const needle = query.trim().toLowerCase();
  const keep = (r: Row) => !needle || r.name.toLowerCase().includes(needle) || (servers[r.host]?.name || r.host).toLowerCase().includes(needle);

  const { incoming, unconfirmed, friends } = useMemo(() => {
    const incoming: Row[] = [];
    const unconfirmed: Row[] = [];
    const friends: Row[] = [];
    for (const h of all) {
      for (const p of h.incoming) incoming.push(rowOf(h.host, p));
      for (const p of h.friends) (p.confirmed ? friends : unconfirmed).push(rowOf(h.host, p));
    }
    const byName = (a: Row, b: Row) => a.name.localeCompare(b.name);
    return { incoming: incoming.sort(byName), unconfirmed: unconfirmed.sort(byName), friends: friends.sort(byName) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, memberLists]);

  // A name on two rows names its server, the same as the conversation list.
  const clashes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of friends) seen.set(r.name, (seen.get(r.name) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [friends]);

  const serverName = (host: string) => servers[host]?.name || host;
  const key = (r: Row) => `${r.host}/${r.person.serverUserId}`;

  function face(r: Row, size: number, ring: string) {
    const status = r.member?.status;
    return (
      <span className="relative inline-flex shrink-0">
        <Avatar
          className={size === 34 ? "h-[34px] w-[34px]" : undefined}
          size="small"
          fallback={r.name[0]}
          src={resolveAvatarSrc(
            r.member?.avatarFileId ? getUploadsFileUrl(r.host, r.member.avatarFileId, { thumb: true }) : undefined,
            r.name,
            r.member?.avatarWorn,
          )}
        />
        {status && (
          <span className="absolute rounded-(--gryt-radius-full)" style={{ bottom: -1, right: -1, padding: 2, background: ring }}>
            <PresenceDot status={status} size={9} />
          </span>
        )}
      </span>
    );
  }

  /* Face, name and the server it came through, as one button that opens their card,
     so you can see who it is before you say yes. */
  function who(r: Row) {
    const open = cardFor === key(r);
    const trigger = (
      <span className="flex min-w-0 items-center gap-2.5">
        {face(r, 34, open ? "var(--gryt-neutral-4)" : "var(--gryt-neutral-2)")}
        <span className="flex min-w-0 flex-col text-left">
          <span className="truncate text-sm font-semibold"><EmojiText text={r.name} /></span>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gryt-muted">
            <span style={{ width: 14, height: 14, borderRadius: 5, overflow: "hidden", display: "block", flexShrink: 0 }}>
              <ServerMark src={serverIconSrc(r.host, servers[r.host]?.name || "", serverDetailsList)} seed={serverName(r.host)} />
            </span>
            {serverName(r.host)}
          </span>
        </span>
      </span>
    );
    if (!r.member) return trigger;
    return (
      <Popover.Root open={open} onOpenChange={(next) => setCardFor(next ? key(r) : null)}>
        <Popover.Trigger
          render={
            <button
              type="button"
              aria-label={`Open ${r.name}’s card`}
              className="-ml-1 -mt-1 flex min-w-0 cursor-pointer items-center rounded-(--gryt-radius-md) border-0 p-1 pr-1.5 text-gryt-text hover:bg-gryt-neutral-3"
              style={{ background: open ? "var(--gryt-neutral-4)" : undefined }}
            />
          }
        >
          {trigger}
        </Popover.Trigger>
        {open && (
          <Popover.Portal>
            <Popover.Positioner side="right" align="start" sideOffset={12}>
              <Popover.Popup className={MEMBER_CARD_POPUP}>
                <MemberIdentityCard member={r.member} serverHost={r.host} />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        )}
      </Popover.Root>
    );
  }

  function request(r: Row, line: string, actions: ReactNode) {
    return (
      <div key={key(r)} data-gryt="friend-row" data-state="request" className="flex flex-col gap-1.5 rounded-(--gryt-radius-lg) px-2.5 py-2">
        {who(r)}
        <span className="pl-11 text-xs text-gryt-neutral-11">{line}</span>
        <span className="flex gap-1.5 pl-11">{actions}</span>
      </div>
    );
  }

  function statusLine(r: Row): string {
    const m = r.member;
    const where = clashes.has(r.name) ? ` · ${serverName(r.host)}` : "";
    if (!m) return `Not on ${serverName(r.host)} right now`;
    if (m.status !== "offline" && m.richActivity?.name) return `Playing ${m.richActivity.name}`;
    return `${statusConfig[m.status].label}${where}`;
  }

  function friend(r: Row) {
    return (
      <ContextMenu.Root key={key(r)}>
        <ContextMenu.Trigger>
          <div data-gryt="friend-row" data-state="friend" className="flex items-center gap-2.5 rounded-(--gryt-radius-lg) px-2.5 py-1.5 hover:bg-gryt-neutral-3">
            {face(r, 34, "var(--gryt-neutral-2)")}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold"><EmojiText text={r.name} /></span>
              <span className="truncate text-xs text-gryt-muted">{statusLine(r)}</span>
            </span>
            <IconButton
              size="small"
              tone="neutral"
              aria-label={`Message ${r.name}`}
              onClick={() => messagePerson(r.host, r.person.serverUserId)}
            >
              <PiChatTeardropTextFill size={14} />
            </IconButton>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup className="min-w-55">
              <ContextMenu.Group>
                <ContextMenu.GroupLabel>{r.name}</ContextMenu.GroupLabel>
              </ContextMenu.Group>
              <ContextMenu.Item onClick={() => messagePerson(r.host, r.person.serverUserId)}>Message</ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item onClick={() => friendAction(r.host, "remove", r.person.serverUserId)}>Remove friend</ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  }

  const visibleRequests = [...incoming.filter(keep), ...unconfirmed.filter(keep)];
  const visibleFriends = friends.filter(keep);

  if (incoming.length + unconfirmed.length + friends.length === 0) {
    return (
      <p className="px-4 py-2 text-xs text-gryt-muted">
        No friends yet. Right-click somebody on a server, or open your conversation with them, and pick Add friend.
      </p>
    );
  }

  return (
    <div data-gryt="friends-panel" className="flex flex-col overflow-y-auto px-2 pb-2">
      <Section title="Requests" count={visibleRequests.length}>
        {incoming.filter(keep).map((r) =>
          request(r, "Wants to be friends", (
            <>
              <Button size="xsmall" onClick={() => friendAction(r.host, "accept", r.person.serverUserId)}>Accept</Button>
              <Button size="xsmall" tone="neutral" onClick={() => friendAction(r.host, "decline", r.person.serverUserId)}>Decline</Button>
            </>
          )),
        )}
        {/* friendList.ts: the server lists a friendship this device never asked for or accepted. */}
        {unconfirmed.filter(keep).map((r) =>
          request(r, "The server says you’re friends. Until you add them here, they can’t call you on this device.", (
            <>
              <Button size="xsmall" onClick={() => confirmServerFriend(r.host, r.person)}>Add</Button>
              <Button size="xsmall" tone="neutral" onClick={() => friendAction(r.host, "remove", r.person.serverUserId)}>Remove</Button>
            </>
          )),
        )}
      </Section>
      <Section title="Friends" count={visibleFriends.length}>
        {visibleFriends.map(friend)}
      </Section>
      {needle && visibleRequests.length + visibleFriends.length === 0 && (
        <p className="px-2.5 py-2 text-xs text-gryt-muted">Nobody matches &ldquo;{query}&rdquo;.</p>
      )}
    </div>
  );
}
