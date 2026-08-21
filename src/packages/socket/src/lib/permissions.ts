/**
 * The permissions a role can carry, and how to talk about them.
 *
 * The server is the authority on this list — it ships the catalogue with the
 * role editor payload, so an older client talking to a newer server still shows
 * every permission that server has. What lives here is the *presentation*: the
 * grouping, the labels and the one-line descriptions, none of which the server
 * has any business knowing.
 *
 * A permission the server sends that is not described here still renders, under
 * its own id. That is deliberately ugly rather than hidden: a permission the
 * editor silently dropped would be a permission the next save silently removed.
 */
export type PermissionMeta = {
  id: string;
  label: string;
  description: string;
};

export type PermissionGroup = {
  title: string;
  description: string;
  permissions: PermissionMeta[];
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: "Text",
    description: "Reading is never a permission — anybody who is in can read.",
    permissions: [
      { id: "send_messages", label: "Send messages", description: "Post in text channels." },
      { id: "attach_files", label: "Attach files", description: "Upload images and files with a message." },
      { id: "add_reactions", label: "Add reactions", description: "React to somebody else's message." },
    ],
  },
  {
    title: "Voice",
    description: "Joining and speaking are separate, so a role can listen without being heard.",
    permissions: [
      { id: "join_voice", label: "Join voice", description: "Enter a voice channel." },
      { id: "speak", label: "Speak", description: "Be unmuted once in. Without it, they can listen." },
      { id: "share_video", label: "Share video", description: "Turn a camera on." },
      { id: "share_screen", label: "Share screen", description: "Start a screen share." },
    ],
  },
  {
    title: "Themselves",
    description: "What somebody may change about their own presence here.",
    permissions: [
      { id: "change_nickname", label: "Change nickname", description: "Rename themselves on this server." },
      { id: "change_avatar", label: "Change avatar", description: "Set or clear their own picture." },
      { id: "create_invite", label: "Create invites", description: "Mint an invite code." },
    ],
  },
  {
    title: "Moderation",
    description: "Acting on other people. All of these still refuse against an equal or higher role.",
    permissions: [
      { id: "manage_messages", label: "Manage messages", description: "Delete somebody else's message." },
      { id: "kick_members", label: "Kick members", description: "Remove somebody, who may come back." },
      { id: "ban_members", label: "Ban members", description: "Remove somebody and keep them out." },
      { id: "mute_members", label: "Mute members", description: "Server mute, deafen, time out, pull out of voice." },
      { id: "manage_reports", label: "Handle reports", description: "Work the reported-messages queue." },
      { id: "manage_join_requests", label: "Handle join requests", description: "Let people in on a request-only server." },
      { id: "manage_invites", label: "Manage invites", description: "See and revoke every invite this server has issued." },
    ],
  },
  {
    title: "Administration",
    description: "Changing the server itself.",
    permissions: [
      { id: "manage_channels", label: "Manage channels", description: "Add, rename, reorder and remove channels." },
      { id: "manage_emojis", label: "Manage emojis", description: "Upload, rename and delete custom emoji." },
      { id: "manage_webhooks", label: "Manage webhooks", description: "Create and revoke webhooks." },
      { id: "view_audit_log", label: "View audit log", description: "Read what moderators and admins have done." },
      { id: "manage_roles", label: "Manage roles", description: "Edit roles and hand them out. The keys to the building." },
      { id: "manage_server", label: "Manage server", description: "Name, description, icon, limits, join policy." },
    ],
  },
];

const DESCRIBED = new Map(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.id, p] as const)),
);

export function describePermission(id: string): PermissionMeta {
  return DESCRIBED.get(id) ?? { id, label: id, description: "" };
}

/**
 * The catalogue the server sent, arranged for display.
 *
 * Anything the server knows about and this client does not ends up in a
 * trailing group rather than being dropped — see the note at the top.
 */
export function groupPermissions(available: string[]): PermissionGroup[] {
  const known = new Set(available);
  const groups = PERMISSION_GROUPS.map((g) => ({
    ...g,
    permissions: g.permissions.filter((p) => known.has(p.id)),
  })).filter((g) => g.permissions.length > 0);

  const described = new Set(PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.id)));
  const unknown = available.filter((id) => !described.has(id));
  if (unknown.length > 0) {
    groups.push({
      title: "Newer than this client",
      description: "This server knows about these and this build does not. They still save.",
      permissions: unknown.map((id) => ({ id, label: id, description: "" })),
    });
  }

  return groups;
}
