import { Avatar, IconButton, PreviewCard, Tooltip } from "@gryt/ui";
import { PiPushPinFill, PiPushPinSlashFill } from "react-icons/pi";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { UserStatus } from "../types/clients";
import { BotTag } from "./BotTag";
import { MemberIdentityCard } from "./MemberIdentityCard";
import { statusConfig, statusPriority } from "./memberStatus";
import { UserContextMenu } from "./UserContextMenu";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

export interface MemberInfo {
  serverUserId: string;
  nickname: string;
  avatarFileId?: string | null;
  /** Dominant colour of the avatar as #rrggbb. Null until it has been computed. */
  avatarColor?: string | null;
  /**
   * What their owl is wearing, if they designed one — the string `@gryt/owl`
   * encodes. Drawn here rather than fetched, so it stays sharp at any size and
   * follows a palette change. Outranks `avatarFileId`; see `resolveAvatarSrc`
   * for why both are set at once.
   */
  avatarWorn?: string | null;
  role?: Role;
  status: UserStatus;
  lastSeen?: Date;
  createdAt?: string | Date;
  /** Whether there is a Gryt account behind this member, or only a device key. */
  identityTier?: "account" | "local" | "bot";
  /**
   * Whether this member is a bot.
   *
   * The server derives it from the identity, so it cannot be spoofed by a name
   * and cannot be shaken off by one either.
   */
  isBot?: boolean;
  /**
   * Server-scoped marker for the identity, stable across renames. Not the Gryt
   * user id — that one is the same on every server, and this deliberately is
   * not.
   */
  identityFingerprint?: string;
  /**
   * How many times this member has renamed themselves here, and when they last
   * did. The old names are deliberately not sent.
   */
  nicknameChangeCount?: number;
  nicknameChangedAt?: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  color: string;
  isConnectedToVoice: boolean;
  hasJoinedChannel: boolean;
  voiceChannelId?: string;
  streamID: string;
}

export interface AdminActions {
  onDisconnectUser?: (targetServerUserId: string) => void;
  onKickUser?: (targetServerUserId: string) => void;
  onBanUser?: (targetServerUserId: string) => void;
  onServerMuteUser?: (targetServerUserId: string, muted: boolean) => void;
  onServerDeafenUser?: (targetServerUserId: string, deafened: boolean) => void;
  onChangeRole?: (targetServerUserId: string, role: Role) => void;
}

interface MemberSidebarProps {
  members: MemberInfo[];
  currentConnectionId?: string;
  currentServerUserId?: string;
  currentUserRole?: Role;
  currentServerConnected: string | null;
  serverHost: string;
  adminActions?: AdminActions;
  pinned?: boolean;
  onTogglePinned?: () => void;
}


const MemberItem = ({
  member,
  currentServerUserId,
  currentUserRole,
  serverHost,
  adminActions,
}: {
  member: MemberInfo;
  currentServerUserId?: string;
  currentUserRole?: Role;
  serverHost: string;
  adminActions?: AdminActions;
}) => {
  const isSelf = member.serverUserId === currentServerUserId;
  const { label: statusLabel, color: statusColor } = statusConfig[member.status];
  const isOffline = member.status === "offline";

  return (
    <UserContextMenu
      serverHost={serverHost}
      serverUserId={member.serverUserId}
      nickname={member.nickname}
      isSelf={isSelf}
      canDisconnect={!!adminActions?.onDisconnectUser}
      isInVoice={member.hasJoinedChannel}
      onDisconnectFromVoice={adminActions?.onDisconnectUser ? () => adminActions.onDisconnectUser!(member.serverUserId) : undefined}
      role={currentUserRole}
      targetRole={member.role}
      isServerMuted={member.isServerMuted}
      isServerDeafened={member.isServerDeafened}
      onKick={adminActions?.onKickUser ? () => adminActions.onKickUser!(member.serverUserId) : undefined}
      onBan={adminActions?.onBanUser ? () => adminActions.onBanUser!(member.serverUserId) : undefined}
      onServerMute={adminActions?.onServerMuteUser ? (muted) => adminActions.onServerMuteUser!(member.serverUserId, muted) : undefined}
      onServerDeafen={adminActions?.onServerDeafenUser ? (deafened) => adminActions.onServerDeafenUser!(member.serverUserId, deafened) : undefined}
      onChangeRole={adminActions?.onChangeRole ? (role) => adminActions.onChangeRole!(member.serverUserId, role) : undefined}
    >
      <PreviewCard.Root>
        <PreviewCard.Trigger>
          <div
            style={{
              background: "var(--gryt-neutral-4)",
              borderRadius: "var(--gryt-radius-xl)",
              padding: "8px 12px",
              cursor: 'default',
            }}
          >
        <div className="flex items-center gap-2 w-full">
          <Avatar
            size="small"
            fallback={member.nickname[0]}
            src={resolveAvatarSrc(member.avatarFileId ? getUploadsFileUrl(serverHost, member.avatarFileId, { thumb: true }) : undefined, member.nickname, member.avatarWorn)}
            style={{
              backgroundColor: member.color,
              opacity: isOffline ? 0.4 : 1,
            }}
          />

          <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: "1px" }}>
            <div className="flex items-center gap-1">
              <span className="text-sm" style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: isOffline ? statusColor : undefined,
                }}>
                {member.nickname}
              </span>
              {member.isBot && <BotTag size="small" />}
            </div>

            <span className="text-xs" style={{ color: statusColor, lineHeight: 1.2 }}>
              {statusLabel}
            </span>
          </div>
        </div>
          </div>
        </PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner side="left" align="start">
            <PreviewCard.Popup>
          <MemberIdentityCard member={member} />
        </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </UserContextMenu>
  );
};

export const MemberSidebar = ({
  members,
  currentServerUserId,
  currentUserRole,
  serverHost,
  adminActions,
  pinned,
  onTogglePinned,
}: MemberSidebarProps) => {
  const sortedMembers = [...members].sort((a, b) => {
    const priorityDiff = statusPriority[a.status] - statusPriority[b.status];
    if (priorityDiff !== 0) return priorityDiff;
    return a.nickname.localeCompare(b.nickname);
  });

  return (
    <div role="complementary" aria-label="Members" style={{ width: "240px",
        background: "var(--gryt-neutral-3)",
        borderRadius: "var(--gryt-radius-lg)",
        height: "100%",
        overflow: "hidden",
      }}>
      <div className="flex flex-col h-full p-3 gap-1">
        <div className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-gryt-muted">
              Members — {members.length}
            </span>
            {onTogglePinned && (
              <Tooltip title={pinned ? "Unpin sidebar" : "Pin sidebar"}>
                <IconButton tone="neutral" size="xsmall"
                  onClick={onTogglePinned}
                  aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
                >
                  {pinned ? <PiPushPinFill size={14} /> : <PiPushPinSlashFill size={14} />}
                </IconButton>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2" style={{ overflow: "auto", flex: 1 }}>
          {sortedMembers.map((member) => (
            <MemberItem
              key={member.serverUserId}
              member={member}
              currentServerUserId={currentServerUserId}
              currentUserRole={currentUserRole}
              serverHost={serverHost}
              adminActions={adminActions}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
