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
   * channel has no opinion.
   *
   * A channel somebody may not read is not in this array at all — the server
   * leaves it out of `server:details` rather than sending it with a flag. So
   * nothing reads this to decide whether to draw a channel; it is here for the
   * editor.
   */
  permissionScopeId?: string | null;
  /**
   * Whether this member may post here, resolved by the server for them.
   *
   * The scope rules that decide it are only readable with `manage_channels`, so
   * a client cannot work this out — which is why a read-only channel used to
   * draw an ordinary composer and refuse whatever was typed into it.
   *
   * Absent is not false: an unknown answer has to mean "try", or every channel
   * on an older server would look read-only.
   */
  canSend?: boolean;
  /**
   * Whether this member may enter this voice channel, resolved by the server.
   *
   * Visibility and entry are different questions: a voice channel is visible to
   * anybody who may read it, and `join_voice` decides who gets in. So a room
   * can be visible and shut, which nothing drew — the row looked open and the
   * refusal came out of the media stack.
   *
   * Absent from an older server, and absent reads as yes, as `canSend` does.
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
   * The folder this channel sits in, or absent for the top level.
   *
   * Only a channel ever has one. The server drops it for every other kind, so
   * a folder inside a folder never comes back however it was sent.
   */
  parentItemId?: string | null;
};

/**
 * One line of a reorder.
 *
 * A bare id means "this position, whatever folder it is already in", which is
 * what a drag straight up or down sends. The object form is for a drag that
 * crossed the indent threshold and changed the folder as well.
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
     * A role id. Used to be one of four names; a server defines its own now, so
     * anything that wants to *show* a role looks it up in `roles` below and
     * anything that wants to gate on one reads `permissions`.
     */
    role?: string;
    /**
     * What this client may do here, as the server sees it.
     *
     * Advisory. Every one of these is enforced server-side as well, and the UI
     * uses them only to stop offering what would be refused — a client that
     * ignores the list gets an error rather than an action.
     */
    permissions?: string[];
    /**
     * Every permission the *server* knows about, which is not the same list
     * this build knows about.
     *
     * Without it an absence in `permissions` is ambiguous: a denial, or a
     * permission this client has heard of and that server has not. Reading the
     * second as a denial is how a client that learns about `read_messages`
     * first blanks out every channel on a server not yet upgraded.
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
     * Every plugin this server is running, and what each one may do
     * (GRYT-939, GRYT-941).
     *
     * All of them — an operator cannot keep one off this list. A member is the
     * one whose messages are being read, so what code sits between them and the
     * people they are talking to is theirs to know.
     *
     * No version, on purpose: a version number is which known problem applies,
     * and a server does not hand that to everybody who joins.
     *
     * Absent from a server too old to say, which is not the same as a server
     * running nothing.
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
   * When a request to join was made, for a server that admits people by
   * approval (GRYT-289).
   *
   * Present means the request is outstanding. Set when the server answers a
   * join with `approval_pending`, cleared the moment a join succeeds.
   *
   * A timestamp rather than a flag so the entry can say how long it has been
   * waiting.
   */
  approvalRequestedAt?: number;
};

export type Servers = {
  [host: string]: Server;
};
