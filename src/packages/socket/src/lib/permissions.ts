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
/**
 * What a server knew about before it published a catalogue.
 *
 * A server from the first release of this feature sends the caller's
 * permissions and no list of what it has heard of, so an absence there is
 * ambiguous. This is the list it must have had, used as the catalogue it did
 * not send — anything outside it is a permission that build could not have been
 * withholding.
 *
 * Frozen. It describes a release that has already happened, so it never grows.
 */
export const PERMISSIONS_BEFORE_CATALOGUE: readonly string[] = [
  "send_messages",
  "attach_files",
  "add_reactions",
  "join_voice",
  "speak",
  "share_video",
  "share_screen",
  "change_nickname",
  "change_avatar",
  "create_invite",
  "manage_invites",
  "manage_messages",
  "kick_members",
  "ban_members",
  "mute_members",
  "manage_reports",
  "manage_join_requests",
  "manage_channels",
  "manage_emojis",
  "manage_webhooks",
  "manage_roles",
  "manage_server",
  "view_audit_log",
];

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
    description: "Reading is a permission of its own — a role without it is here and cannot see the place.",
    permissions: [
      { id: "read_messages", label: "Read messages", description: "See channel history, and messages as they arrive." },
      { id: "send_messages", label: "Send messages", description: "Post in text channels." },
      { id: "edit_own_messages", label: "Edit own messages", description: "Revise something they posted." },
      { id: "delete_own_messages", label: "Delete own messages", description: "Take back something they posted." },
      { id: "attach_files", label: "Attach files", description: "Upload images and files with a message." },
      { id: "add_reactions", label: "Add reactions", description: "React to somebody else's message." },
      { id: "send_direct_messages", label: "Send direct messages", description: "Open a conversation with another member, and post in one. Reading one they are already in is not gated on this." },
      { id: "report_messages", label: "Report messages", description: "Put a message in front of the moderators." },
      { id: "use_link_previews", label: "See link previews", description: "Have links in the channel unfurled. Off means plain links." },
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
      { id: "start_calls", label: "Start calls", description: "Ring somebody in a direct message. Answering one is Join voice, so a role without this can still be called." },
    ],
  },
  {
    title: "Themselves and each other",
    description: "What somebody may change about their own presence, and who they can see.",
    permissions: [
      { id: "change_nickname", label: "Change nickname", description: "Rename themselves on this server." },
      { id: "change_avatar", label: "Change avatar", description: "Set or clear their own picture." },
      { id: "view_members", label: "See the member list", description: "Know who else is here." },
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
      { id: "view_bans", label: "See the ban list", description: "Read who is banned without being able to add to it." },
      { id: "mute_members", label: "Mute members", description: "Server mute, and time somebody out." },
      { id: "deafen_members", label: "Deafen members", description: "Decide what somebody may hear in voice." },
      { id: "disconnect_members", label: "Disconnect from voice", description: "Pull somebody out of a voice channel." },
      { id: "view_reports", label: "See reports", description: "Read the reported-messages queue." },
      { id: "manage_reports", label: "Handle reports", description: "Act on what is in it." },
      { id: "manage_join_requests", label: "Handle join requests", description: "Let people in on a request-only server." },
      { id: "manage_invites", label: "Manage invites", description: "See and revoke every invite this server has issued." },
    ],
  },
  {
    title: "Administration",
    description: "Changing the server itself.",
    permissions: [
      { id: "manage_channels", label: "Manage channels", description: "Add, rename and remove channels." },
      { id: "manage_sidebar", label: "Manage the sidebar", description: "Separators, spacers, and what order things are in." },
      { id: "manage_emojis", label: "Manage emojis", description: "Upload, rename and delete custom emoji." },
      { id: "manage_webhooks", label: "Manage webhooks", description: "Create and revoke webhooks." },
      { id: "view_audit_log", label: "View audit log", description: "Read what moderators and admins have done." },
      { id: "view_server_status", label: "See server status", description: "Whether this server is running a current build." },
      { id: "manage_roles", label: "Manage roles", description: "Edit roles and hand them out. The keys to the building." },
      { id: "manage_bots", label: "Manage bots", description: "Answer bots at the door and decide what they may do." },
      { id: "manage_server", label: "Manage server", description: "Name, description, icon, limits, join policy." },
      { id: "replace_identity", label: "Replace an identity", description: "Hand an existing membership to a different account. The most dangerous thing here." },
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
