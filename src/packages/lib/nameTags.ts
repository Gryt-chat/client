/* Byte for byte the same in client (src/packages/lib) and mobile (src/chat).
   GRYT-1674: two members called Gold, and nothing on screen to tell them apart. */

export interface TaggableMember {
  serverUserId: string;
  nickname: string;
  /** Server-keyed HMAC, so a matching tag can't be ground out offline. */
  identityFingerprint?: string;
}

/** How many characters of the fingerprint a tag shows. */
export const NAME_TAG_LENGTH = 4;

/** Names compared the way a reader compares them: case and edge spaces don't count. */
function nameKey(nickname: string): string {
  return nickname.trim().toLowerCase();
}

/**
 * A short tag for every member whose name someone else here also uses, keyed by
 * server user id. Members with a name of their own get none, so most lists show nothing.
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
    for (const member of list) {
      // An older server sends no fingerprint; the id still differs, if less nicely.
      const source = member.identityFingerprint || member.serverUserId;
      tags.set(member.serverUserId, source.slice(0, NAME_TAG_LENGTH));
    }
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
