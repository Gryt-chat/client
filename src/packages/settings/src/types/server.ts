export type ForumTag = {
  id: string;
  name: string;
  emoji?: string | null;
  color?: string | null;
};

export type Channel = {
  name: string;
  type: "text" | "voice";
  id: string;
  clients?: string[];
  requirePushToTalk?: boolean;
  disableRnnoise?: boolean;
  maxBitrate?: number | null;
  eSportsMode?: boolean;
  textInVoice?: boolean;
  /** A forum-layout text channel shows a list of topics instead of a chat stream. Absent means chat. GRYT-981. */
  layout?: "chat" | "forum";
  /** An automated channel: only bots and the system may post. People read only. GRYT-982. */
  automated?: boolean;
  /** A forum channel's tag palette. GRYT-981 Stage 3. */
  forumTags?: ForumTag[];
  /**
   * Which permission scope decides what each role may do here, or null when the
   * channel has no opinion. For the editor — an unreadable channel is not sent.
   */
  permissionScopeId?: string | null;
  /**
   * Whether this member may post here, resolved by the server. Absent is not
   * false: an unknown answer means "try", or every older server looks read-only.
   */
  canSend?: boolean;
  /**
   * Whether this member may enter this voice channel. Visibility and entry are
   * different questions, so a room can be visible and shut. Absent reads as yes.
   */
  canJoin?: boolean;
};

export type SidebarItemKind = "channel" | "separator" | "spacer" | "folder";

export type SidebarItem = {
  id: string;
  kind: SidebarItemKind;
  position?: number;
  // For kind="channel"
  channelId?: string | null;
  // For kind="spacer"
  spacerHeight?: number | null;
  // For kind="separator" and kind="folder"
  label?: string | null;
  /**
   * The folder this channel sits in, or absent for the top level. Only a channel
   * ever has one, so a folder inside a folder never comes back.
   */
  parentItemId?: string | null;
};

/**
 * One line of a reorder. A bare id means "this position, whatever folder it is
 * in"; the object form is for a drag that changed the folder as well.
 */
export type SidebarReorderEntry = string | { itemId: string; parentItemId: string | null };

export type serverDetails = {
  sidebar_items?: SidebarItem[];
  channels: Channel[];
  sfu_host: string;
  sfu_hosts?: string[];
  stun_hosts: string[];
  voice_capacity_max?: number | null;
  clients?: Record<string, unknown>;
  server_info?: {
    server_id?: string;
    name?: string;
    description?: string;
    icon_url?: string | null;
    is_owner?: boolean;
    /**
     * A role id. A server defines its own, so anything showing a role looks it up
     * in `roles` and anything gating on one reads `permissions`.
     */
    role?: string;
    /**
     * What this client may do here, as the server sees it. Advisory — all of it is
     * enforced server-side, and this only stops the UI offering a refusal.
     */
    permissions?: string[];
    /**
     * Every permission the *server* knows about, which is not this build's list.
     * Without it, an absence in `permissions` is a denial or an unknown word.
     */
    permission_catalogue?: string[];
    /** Every role this server has defined, for colouring and labelling people. */
    roles?: {
      id: string;
      name: string;
      color: string | null;
      rank: number;
      permissions: string[];
      isSystem: boolean;
    }[];
    max_members?: number;
    voice_enabled?: boolean;
    avatar_max_bytes?: number | null;
    upload_max_bytes?: number | null;
    version?: string;
    /**
     * Every plugin this server is running, and what each may do. All of them — an
     * operator cannot keep one off the list. Absent from a server too old to say.
     */
    plugins?: {
      id: string;
      name?: string;
      author?: string;
      description?: string;
      homepage?: string;
      capabilities?: string[];
    }[];
  };
  error?: string;
  message?: string;
};

export type serverDetailsList = {
  [host: string]: serverDetails;
};

export type Server = {
  host: string;
  name: string;
  token?: string;
  serverId?: string;
  /**
   * When a request to join was made, for a server that admits by approval. Present
   * means outstanding; a timestamp so the entry can say how long (GRYT-289).
   */
  approvalRequestedAt?: number;
};

export type Servers = {
  [host: string]: Server;
};
