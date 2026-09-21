/**
 * Who the new-message dialog offers, and which conversation answers a request. Pure,
 * so a check can run it without a browser (GRYT-1342).
 */

/** A member of one server. Two servers can each have a Bob, and the client can't tell if they're one person. */
export interface Candidate {
  host: string;
  serverUserId: string;
  nickname: string;
  avatarFileId: string | null;
  avatarWorn: string | null;
}

export interface ServerPeople {
  host: string;
  /** Your own id there, so you aren't offered to yourself. */
  selfId: string | undefined;
  members: {
    serverUserId: string;
    nickname: string;
    avatarFileId?: string | null;
    avatarWorn?: string | null;
    isBot?: boolean;
  }[];
  /** `send_direct_messages` there, and the server takes new conversations. */
  canMessage: boolean;
  /** `create_groups` there. */
  canGroup: boolean;
}

export type NewMessageMode = "message" | "group";

/** Everybody you could message, or put in a group, sorted by name and then server. */
export function candidatesFor(servers: ServerPeople[], mode: NewMessageMode): Candidate[] {
  const out: Candidate[] = [];
  for (const server of servers) {
    if (!server.canMessage) continue;
    if (mode === "group" && !server.canGroup) continue;
    for (const member of server.members) {
      // The server refuses a bot in either, and without your own id every row could be you.
      if (member.isBot || !server.selfId || member.serverUserId === server.selfId) continue;
      out.push({
        host: server.host,
        serverUserId: member.serverUserId,
        nickname: member.nickname,
        avatarFileId: member.avatarFileId ?? null,
        avatarWorn: member.avatarWorn ?? null,
      });
    }
  }
  return out.sort(
    (a, b) =>
      a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base" })
      || compare(a.host, b.host)
      || compare(a.serverUserId, b.serverUserId),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Matched on the name and on the server, which is what tells two Bobs apart. */
export function matching(
  list: Candidate[],
  query: string,
  serverName: (host: string) => string,
): Candidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return list;
  return list.filter(
    (c) => c.nickname.toLowerCase().includes(needle) || serverName(c.host).toLowerCase().includes(needle),
  );
}

interface ConversationLike {
  conversation_id: string;
  kind: "dm" | "group";
  other?: { server_user_id: string };
  members?: { server_user_id: string }[];
}

/** Your one-to-one with this person on this server, if the server has sent it. */
export function directWith<T extends ConversationLike>(
  entries: { host: string; conversation: T }[],
  host: string,
  serverUserId: string,
): T | undefined {
  return entries.find(
    (e) => e.host === host && e.conversation.kind === "dm" && e.conversation.other?.server_user_id === serverUserId,
  )?.conversation;
}

/**
 * The group a create made. The server answers with `dm:opened` and no request id, so
 * it's the one on that host that wasn't there before, with exactly the people picked.
 */
export function createdGroup<T extends ConversationLike>(
  entries: { host: string; conversation: T }[],
  host: string,
  before: ReadonlySet<string>,
  picked: readonly string[],
): T | undefined {
  const wanted = [...new Set(picked)].sort().join(",");
  return entries.find((e) => {
    if (e.host !== host || e.conversation.kind !== "group") return false;
    if (before.has(e.conversation.conversation_id)) return false;
    const people = (e.conversation.members ?? []).map((m) => m.server_user_id).sort().join(",");
    return people === wanted;
  })?.conversation;
}
