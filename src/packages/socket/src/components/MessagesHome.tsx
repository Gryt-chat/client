import { Avatar, Button, Menu, Popover } from "@gryt/ui";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { getUploadsFileUrl, resolveAvatarSrc, serverIconSrc } from "@/common";

import { PiChatTeardropTextFill, PiDotsThreeBold, PiMagnifyingGlassBold, PiPhoneFill, PiSpeakerHighFill, PiUsersFill } from "../../../../lib/icons";
import { requestCall } from "../hooks/callRequest";
import { useDirectory } from "../hooks/dmDirectory";
import { useAllFriends } from "../hooks/friendsStore";
import { setNewMessageOpen } from "../hooks/newMessageDialog";
import { conversationTitle } from "../hooks/useDirectMessages";
import { useDirectoryUnread } from "../hooks/useDirectoryUnread";
import { useMessagePerson } from "../hooks/useMessagePerson";
import { useServerManagement } from "../hooks/useServerManagement";
import { useSockets } from "../hooks/useSockets";
import { requestVoiceJoin } from "../hooks/voiceJoinRequest";
import { EmojiText } from "./EmojiText";
import { MEMBER_CARD_POPUP } from "./memberCard/memberCardContext";
import { MemberIdentityCard } from "./MemberIdentityCard";
import type { MemberInfo } from "./MemberSidebar";
import { statusConfig } from "./memberStatus";
import { PresenceDot } from "./PresenceDot";
import { ServerMark } from "./ServerChip";

/**
 * What the messages space shows with no conversation open: your friends, where
 * they are, and the two ways to start something. Only friends this device added.
 */

interface Friend {
  host: string;
  serverUserId: string;
  name: string;
  member?: MemberInfo;
}

function faceSrc(f: Friend): string | undefined {
  return resolveAvatarSrc(
    f.member?.avatarFileId ? getUploadsFileUrl(f.host, f.member.avatarFileId, { thumb: true }) : undefined,
    f.name,
    f.member?.avatarWorn,
  );
}

/** The avatar with its presence dot, cut out of whatever it sits on. */
function Face({ friend, size, ring }: { friend: Friend; size: number; ring: string }) {
  const status = friend.member?.status;
  const offline = !status || status === "offline";
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar
        style={{ width: size, height: size, opacity: offline ? 0.4 : 1 }}
        fallback={friend.name[0]}
        src={faceSrc(friend)}
      />
      {status && (
        <span className="absolute rounded-(--gryt-radius-full)" style={{ bottom: -1, right: -1, padding: 2.5, background: ring }}>
          <PresenceDot status={status} size={Math.max(9, Math.round(size / 4.4))} />
        </span>
      )}
    </span>
  );
}

/** 172×76: face and dot, name, one status line, and a ⋯ saying a click opens a menu. */
function MiniCard({
  friend: f, menuOpen, onMenu, cardOpen, onCard, status, onMessage, onCall,
}: {
  friend: Friend;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  cardOpen: boolean;
  onCard: (open: boolean) => void;
  status: ReactNode;
  onMessage: () => void;
  onCall: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Menu.Root open={menuOpen} onOpenChange={onMenu}>
        <Menu.Trigger
          ref={anchor}
          render={
            <button
              type="button"
              data-gryt="friend-mini"
              aria-label={`${f.name}, ${f.member ? statusConfig[f.member.status].label : "Offline"}: open menu`}
              className="relative flex h-[76px] w-[172px] cursor-pointer items-center gap-3 rounded-(--gryt-radius-lg) border-0 bg-gryt-neutral-3 px-3 text-left text-gryt-text hover:bg-gryt-neutral-4"
            />
          }
        >
          <Face friend={f} size={44} ring="var(--gryt-neutral-3)" />
          <span className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-[15px] font-bold"><EmojiText text={f.name} /></span>
            {status}
          </span>
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-(--gryt-radius-full)"
            style={{ color: menuOpen ? "var(--gryt-text)" : "var(--gryt-muted)", background: menuOpen ? "var(--gryt-neutral-4)" : "transparent" }}
          >
            <PiDotsThreeBold size={16} />
          </span>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner side="right" align="start" sideOffset={8}>
            <Menu.Popup className="min-w-60">
              <Menu.Item onClick={onMessage}><PiChatTeardropTextFill size={16} /> Message</Menu.Item>
              <Menu.Item onClick={onCall}><PiPhoneFill size={16} /> Call</Menu.Item>
              {f.member && <Menu.Item onClick={() => onCard(true)}><PiUsersFill size={16} /> Open card</Menu.Item>}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {cardOpen && f.member && (
        <Popover.Root open onOpenChange={onCard}>
          <Popover.Portal>
            <Popover.Positioner anchor={anchor} side="right" align="start" sideOffset={8}>
              <Popover.Popup className={MEMBER_CARD_POPUP}>
                <MemberIdentityCard member={f.member} serverHost={f.host} />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
    </>
  );
}

const SECTION = "px-0.5 text-[13px] font-bold text-gryt-neutral-11";

export function MessagesHome({ onSearch }: { onSearch: () => void }) {
  const all = useAllFriends();
  const { memberLists, serverDetailsList } = useSockets();
  const { servers, switchToServer } = useServerManagement();
  const directory = useDirectory();
  const { countFor } = useDirectoryUnread();
  const messagePerson = useMessagePerson();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [cardFor, setCardFor] = useState<string | null>(null);

  const friends = useMemo(() => {
    const out: Friend[] = [];
    for (const h of all) {
      for (const p of h.friends) {
        if (!p.confirmed) continue;
        const member = memberLists[h.host]?.find((m) => m.serverUserId === p.serverUserId);
        out.push({ host: h.host, serverUserId: p.serverUserId, name: member?.nickname || p.nickname || "Somebody", member });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [all, memberLists]);

  const serverName = (host: string) => servers[host]?.name || host;
  const channelName = (host: string, id?: string) => (id ? serverDetailsList[host]?.channels?.find((c) => c.id === id)?.name : undefined);
  const key = (f: Friend) => `${f.host}/${f.serverUserId}`;

  // One tile per channel, since friends in the same one are one place to go.
  const inVoice = friends.filter((f) => f.member?.status === "in_voice" && f.member.voiceChannelId);
  const rooms = useMemo(() => {
    const byRoom = new Map<string, { host: string; channelId: string; people: Friend[] }>();
    for (const f of inVoice) {
      const id = `${f.host}/${f.member!.voiceChannelId}`;
      const room = byRoom.get(id) ?? { host: f.host, channelId: f.member!.voiceChannelId!, people: [] };
      room.people.push(f);
      byRoom.set(id, room);
    }
    return [...byRoom.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends]);
  const online = friends.filter((f) => f.member && f.member.status !== "offline" && f.member.status !== "in_voice");
  const offline = friends.filter((f) => !f.member || f.member.status === "offline");

  const waiting = directory
    .filter((e) => countFor(e.host, e.conversation.conversation_id) > 0)
    .map((e) => (e.conversation.kind === "group" ? `your group with ${conversationTitle(e.conversation)}` : conversationTitle(e.conversation)));

  const summary = [
    friends.length === 0
      ? "Add friends from a member list, and they show up here."
      : `${inVoice.length + online.length} of your friends ${inVoice.length + online.length === 1 ? "is" : "are"} online${inVoice.length > 0 ? `, ${inVoice.length} in voice` : ""}.`,
    waiting.length === 0
      ? ""
      : `${waiting.length > 2 ? `${waiting.slice(0, 2).join(", ")} and ${waiting.length - 2} more` : waiting.join(" and ")} ${waiting.length === 1 ? "has" : "have"} new messages.`,
  ].filter(Boolean).join(" ");

  function statusLine(f: Friend) {
    const m = f.member;
    if (!m || m.status === "offline") return <span className="text-xs font-semibold" style={{ color: statusConfig.offline.color }}>Offline</span>;
    const game = m.richActivity?.name;
    if (game) return <span className="truncate text-xs font-semibold" style={{ color: "var(--gryt-secondary-9)" }}>{game}</span>;
    return <span className="text-xs font-semibold" style={{ color: statusConfig[m.status].color }}>{statusConfig[m.status].label}</span>;
  }

  function miniCard(f: Friend) {
    return (
      <MiniCard
        key={key(f)}
        friend={f}
        menuOpen={menuFor === key(f)}
        onMenu={(next) => setMenuFor(next ? key(f) : null)}
        cardOpen={cardFor === key(f)}
        onCard={(next) => setCardFor(next ? key(f) : null)}
        status={statusLine(f)}
        onMessage={() => messagePerson(f.host, f.serverUserId)}
        onCall={() => {
          requestCall(f.host, f.serverUserId);
          messagePerson(f.host, f.serverUserId);
        }}
      />
    );
  }

  function voiceTile(room: { host: string; channelId: string; people: Friend[] }) {
    const name = channelName(room.host, room.channelId) ?? "Voice";
    return (
      <div key={`${room.host}/${room.channelId}`} data-gryt="voice-tile" className="flex w-[260px] flex-col gap-3 rounded-(--gryt-radius-lg) bg-gryt-neutral-3 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span style={{ width: 24, height: 24, borderRadius: "calc(var(--gryt-radius-md) * 0.75)", overflow: "hidden", display: "block", flexShrink: 0 }}>
            <ServerMark src={serverIconSrc(room.host, servers[room.host]?.name || "", serverDetailsList)} seed={serverName(room.host)} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <PiSpeakerHighFill size={14} style={{ color: "var(--gryt-accent)" }} aria-hidden />
              <span className="truncate">{name}</span>
            </span>
            <span className="truncate text-xs text-gryt-muted">{serverName(room.host)}</span>
          </span>
          <Button size="small" tone="neutral" onClick={() => {
            requestVoiceJoin(room.host, room.channelId);
            switchToServer(room.host);
          }}>Join</Button>
        </div>
        {/* A row each, so two games, one game or none all read the same way. No speaking
            ring: you can't hear a channel you aren't in. */}
        <div className="flex flex-col gap-2">
          {room.people.map((f) => (
            <div key={key(f)} className="flex min-w-0 items-center gap-2.5">
              <Face friend={f} size={28} ring="var(--gryt-neutral-3)" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold"><EmojiText text={f.name} /></span>
                {f.member?.richActivity?.name && (
                  <span className="truncate text-xs" style={{ color: "var(--gryt-secondary-9)" }}>{f.member.richActivity.name}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <main
      data-gryt="messages-home"
      aria-label="Messages home"
      className="flex grow flex-col gap-9 overflow-y-auto"
      style={{ padding: "48px 56px" }}
    >
      <div className="flex max-w-[560px] flex-col gap-2">
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.015em" }}>Talk to someone</h2>
        <p className="m-0 text-[15px] leading-normal text-gryt-neutral-11">{summary}</p>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <Button size="large" onClick={() => setNewMessageOpen(true)}>
          <PiChatTeardropTextFill size={18} /> New message
        </Button>
        <Button size="large" tone="ghost" onClick={onSearch} className="border border-gryt-border">
          <PiMagnifyingGlassBold size={18} /> Search messages
          <kbd className="rounded-(--gryt-radius-full) border border-gryt-border bg-gryt-neutral-4 px-1.5 text-[11px] text-gryt-neutral-11">
            {navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K"}
          </kbd>
        </Button>
      </div>

      {rooms.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className={SECTION}>In voice <span className="font-normal text-gryt-muted">{inVoice.length}</span></h2>
          <div className="flex flex-wrap gap-2.5">{rooms.map(voiceTile)}</div>
        </section>
      )}
      {online.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className={SECTION}>Online <span className="font-normal text-gryt-muted">{online.length}</span></h2>
          <div className="flex flex-wrap gap-2.5">{online.map(miniCard)}</div>
        </section>
      )}
      {offline.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className={SECTION}>Offline <span className="font-normal text-gryt-muted">{offline.length}</span></h2>
          <div className="flex flex-wrap gap-2.5">{offline.map(miniCard)}</div>
        </section>
      )}
    </main>
  );
}
