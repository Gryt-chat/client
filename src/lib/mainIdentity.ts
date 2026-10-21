/** The main identity (decided 2026-10-21): your name and picture as the first server in the sidebar has them,
    kept as this device's profile so servers you join next get it. Apart so a check can import it. */

export interface FirstServerProfile {
  host: string;
  nickname?: string | null;
  avatarFileId?: string | null;
  avatarVideo?: boolean;
  avatarWorn?: string | null;
}

export interface LocalProfile {
  nickname: string;
  worn: string | null;
  /** `host:fileId` of the picture last copied in, so the same one isn't fetched again. */
  mirroredAvatar: string | null;
}

/** What has to change on this device to match the first server. Empty when it already does. */
export function mainIdentityChanges(first: FirstServerProfile | null, local: LocalProfile): { nickname?: string; worn?: string | null; avatar?: string } {
  if (!first) return {};
  const out: { nickname?: string; worn?: string | null; avatar?: string } = {};
  if (first.nickname && first.nickname !== local.nickname) out.nickname = first.nickname;
  if (first.avatarWorn !== undefined && (first.avatarWorn ?? null) !== local.worn) out.worn = first.avatarWorn ?? null;
  // shortcut: a video avatar isn't copied in, so a still would need the worker's thumbnail; add it if people use them as main.
  const key = first.avatarFileId && !first.avatarVideo ? `${first.host}:${first.avatarFileId}` : null;
  if (key && key !== local.mirroredAvatar) out.avatar = key;
  return out;
}
