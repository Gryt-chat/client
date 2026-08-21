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
};

export type SidebarItemKind = "channel" | "separator" | "spacer";

export type SidebarItem = {
  id: string;
  kind: SidebarItemKind;
  position?: number;
  // For kind="channel"
  channelId?: string | null;
  // For kind="spacer"
  spacerHeight?: number | null;
  // For kind="separator"
  label?: string | null;
};

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
   * Present means the request is outstanding. It is set when the server answers
   * a join with `approval_pending`, and cleared the moment a join succeeds,
   * which is how the sidebar knows to stop showing the server as waiting.
   *
   * A timestamp rather than a flag so the entry can say how long it has been
   * waiting, and so a request that has clearly gone stale is distinguishable
   * from one made a minute ago.
   */
  approvalRequestedAt?: number;
};

export type Servers = {
  [host: string]: Server;
};
