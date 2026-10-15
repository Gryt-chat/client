/**
 * Fake friends, conversations and presence for looking at the messages space against
 * the canvas boards without nine real accounts. `?fakedms`, dev only (GRYT-1741).
 */
import type { DirectConversation } from "@gryt/core";

import type { MemberInfo } from "../components/MemberSidebar";
import type { ServerFriendList } from "../utils/friendList";

export const fakeDmsOn: boolean =
  !!import.meta.env?.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("fakedms");

const id = (name: string) => `fake-${name.toLowerCase()}`;
const LOBBY = "fake-voice-lobby";
const RAID = "fake-voice-raid-night";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

type Person = { name: string; status: MemberInfo["status"]; game?: string; voice?: string };

/** The people on the boards, each in the state the boards draw them in. */
const PEOPLE: Person[] = [
  { name: "Al", status: "in_voice", game: "Counter-Strike 2", voice: LOBBY },
  { name: "Justin", status: "online", game: "Counter-Strike 2" },
  { name: "Ingrid", status: "in_voice", voice: RAID },
  { name: "Maja", status: "in_voice", game: "Deep Rock Galactic", voice: RAID },
  { name: "Carlo", status: "afk" },
  { name: "Mira", status: "offline" },
  { name: "Ole", status: "offline" },
  { name: "Sindre", status: "online" },
  { name: "Eirik", status: "online" },
];

export function fakeMembers(): MemberInfo[] {
  return PEOPLE.map((p) => ({
    serverUserId: id(p.name),
    nickname: p.name,
    status: p.status,
    ...(p.voice ? { voiceChannelId: p.voice } : {}),
    ...(p.game ? { activity: `Playing ${p.game}`, richActivity: { type: "playing" as const, name: p.game } } : {}),
  }) as MemberInfo);
}

export const FAKE_VOICE_CHANNELS = [
  { id: LOBBY, name: "Lobby", type: "voice" as const },
  { id: RAID, name: "Raid night", type: "voice" as const },
];

const participant = (name: string) => ({ server_user_id: id(name), nickname: name, avatar_file_id: null, avatar_worn: null });

const dm = (name: string, minutes: number): DirectConversation => ({
  conversation_id: `fake-dm-${name.toLowerCase()}`,
  kind: "dm",
  name: null,
  icon_file_id: null,
  created_at: minutesAgo(60 * 24 * 30),
  last_message_at: minutesAgo(minutes),
  members: [participant(name)],
  other: participant(name),
});

export function fakeConversations(): DirectConversation[] {
  const group: DirectConversation = {
    conversation_id: "fake-group-saturday-raid",
    kind: "group",
    name: "Saturday raid",
    icon_file_id: null,
    created_at: minutesAgo(60 * 24 * 10),
    last_message_at: minutesAgo(47),
    members: [participant("Al"), participant("Justin"), participant("Carlo")],
    other: participant("Al"),
  };
  return [dm("Al", 3), dm("Carlo", 2), group, dm("Mira", 60 * 24 * 2), dm("Ole", 60 * 24 * 7)];
}

/** What each fake conversation's last line was. */
export const FAKE_PREVIEWS: Record<string, string> = {
  "fake-dm-al": "You: deal, Haz 5 at 20:00 then",
  "fake-dm-carlo": "Did you see the Flathub reply? I think we just need the metainfo fix",
  "fake-group-saturday-raid": "Justin: tomorrow at 20? I can bring the second mic",
  "fake-dm-mira": "Thanks for the invite!",
  "fake-dm-ole": "the server icon looks great now",
};

/** Friends with everyone in the conversations, one request, and one the server says. */
export function fakeFriendList(): ServerFriendList {
  const at = minutesAgo(60 * 24);
  const friend = (name: string) => ({ serverUserId: id(name), nickname: name, at });
  return {
    friends: ["Al", "Justin", "Ingrid", "Maja", "Carlo", "Mira", "Ole", "Eirik"].map(friend),
    incoming: [friend("Sindre")],
    outgoing: [],
  };
}

/** Everyone but Eirik is in this device's book, so Eirik shows as the server's word only. */
export const FAKE_CONFIRMED = ["Al", "Justin", "Ingrid", "Maja", "Carlo", "Mira", "Ole"].map(id);

/* The first connected server carries the fakes, so they live on a host that answers. */
let fakeHost: string | null = null;
const claimed = new Set<(host: string) => void>();

/** Called with each server whose details arrived; the first one wins. */
export function claimFakeHost(host: string): void {
  if (!fakeDmsOn || fakeHost) return;
  fakeHost = host;
  for (const listener of claimed) listener(host);
}

export function onFakeHostClaimed(listener: (host: string) => void): void {
  claimed.add(listener);
}

export function isFakeHost(host: string): boolean {
  return fakeDmsOn && fakeHost === host;
}

/** The server carrying the fakes, once one has claimed it. */
export function fakeHostNow(): string | null {
  return fakeHost;
}

/** Board 1's conversation, as `chat:history` would carry it. Every fake conversation gets it. */
export function fakeHistory(conversationId: string, ownId: string | undefined): Record<string, unknown>[] {
  const other = conversationId === "fake-group-saturday-raid" ? id("Justin") : id(conversationId.replace("fake-dm-", ""));
  const lines: [string, string][] = [
    [other, "you still up for deep rock tonight?"],
    [other, "I want to try Haz 5 again, the new overclock should help with the dreadnought"],
    [ownId ?? "me", "yes! 20:00?"],
    [ownId ?? "me", "deal, Haz 5 at 20:00 then"],
    [other, "perfect. I'll bring the loadout sheet"],
  ];
  return lines.map(([sender, text], i) => ({
    conversation_id: conversationId,
    message_id: `${conversationId}-${i}`,
    sender_server_id: sender,
    text,
    attachments: null,
    created_at: minutesAgo(30 - i * 5),
    edited_at: null,
    reply_to_message_id: null,
    reactions: null,
  }));
}
