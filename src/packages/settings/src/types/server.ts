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
    role?: "owner" | "admin" | "mod" | "member";
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
  // Optional invite code used to join invite-only servers.
  token?: string;
};

export type Servers = {
  [host: string]: Server;
};
