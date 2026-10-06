/* Byte for byte the same in client (src/packages/lib) and mobile (src/chat).
   GRYT-1674: two members called Gold, and nothing on screen to tell them apart. */

export interface TaggableMember {
  serverUserId: string;
  nickname: string;
  /** When they first joined this server. Who was here first is #1. */
  createdAt?: string | Date;
}

/** Names compared the way a reader compares them: case and edge spaces don't count. */
function nameKey(nickname: string): string {
  return nickname.trim().toLowerCase();
}

function joinedAt(member: TaggableMember): number {
  const t = member.createdAt ? new Date(member.createdAt).getTime() : NaN;
  // An older server sends no date; those go last, in a stable order.
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * `#1`, `#2`… in join order for every member whose name someone else here also uses,
 * keyed by server user id. Members with a name of their own get none.
 */
export function nameTags(members: Iterable<TaggableMember>): Map<string, string> {
  const byName = new Map<string, TaggableMember[]>();
  for (const member of members) {
    const key = nameKey(member.nickname ?? "");
    if (!key) continue;
    const list = byName.get(key);
    if (list) list.push(member);
    else byName.set(key, [member]);
  }

  const tags = new Map<string, string>();
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => joinedAt(a) - joinedAt(b) || a.serverUserId.localeCompare(b.serverUserId));
    list.forEach((member, i) => tags.set(member.serverUserId, `#${i + 1}`));
  }
  return tags;
}

const cache = new WeakMap<object, Map<string, string>>();

/** `nameTags` over a member record, worked out once per record object. Every message
    row asks with the same one, so this keeps the pass to one per member-list update. */
export function nameTagsFor(record: Record<string, TaggableMember> | undefined): Map<string, string> {
  if (!record) return new Map();
  let tags = cache.get(record);
  if (!tags) {
    tags = nameTags(Object.values(record));
    cache.set(record, tags);
  }
  return tags;
}
