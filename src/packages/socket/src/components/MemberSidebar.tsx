import { Avatar, Box, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { MdPushPin } from "react-icons/md";
import { MdMicOff, MdVolumeOff, MdVolumeUp } from "react-icons/md";

import { getUploadsFileUrl } from "@/common";

import { UserStatus } from "../types/clients";
import { UserContextMenu } from "./UserContextMenu";

type Role = "owner" | "admin" | "mod" | "member";

export interface MemberInfo {
  serverUserId: string;
  nickname: string;
  avatarFileId?: string | null;
  role?: Role;
  status: UserStatus;
  lastSeen?: Date;
  createdAt?: string | Date;
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
  clientsSpeaking: Record<string, boolean>;
  currentServerConnected: string | null;
  serverHost: string;
  adminActions?: AdminActions;
  pinned?: boolean;
  onTogglePinned?: () => void;
}

const statusConfig: Record<UserStatus, { label: string; color: string }> = {
  in_voice: { label: "In Voice", color: "var(--accent-9)" },
  online: { label: "Online", color: "var(--green-9)" },
  afk: { label: "AFK", color: "var(--amber-9)" },
  offline: { label: "Offline", color: "var(--gray-9)" },
};

const statusPriority: Record<UserStatus, number> = {
  in_voice: 0,
  online: 1,
  afk: 2,
  offline: 3,
};

const MemberItem = ({
  member,
  isSpeaking,
  currentServerUserId,
  currentUserRole,
  serverHost,
  adminActions,
}: {
  member: MemberInfo;
  isSpeaking: boolean;
  currentServerUserId?: string;
  currentUserRole?: Role;
  serverHost: string;
  adminActions?: AdminActions;
}) => {
  const isSelf = member.serverUserId === currentServerUserId;
  const { label: statusLabel, color: statusColor } = statusConfig[member.status];

  return (
    <UserContextMenu
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
      <div
        style={{
          background: "var(--gray-4)",
          borderRadius: "var(--radius-6)",
          padding: "8px 12px",
          cursor: 'default',
          opacity: member.status === 'offline' ? 0.5 : 1,
        }}
      >
        <Flex align="center" gap="2" width="100%">
          <Avatar
            size="2"
            fallback={member.nickname[0]}
            src={member.avatarFileId ? getUploadsFileUrl(serverHost, member.avatarFileId) : undefined}
            style={{
              outline: "2px solid",
              outlineColor: isSpeaking ? "var(--accent-9)" : "transparent",
              transition: "outline-color 0.1s ease",
              backgroundColor: member.color,
            }}
          />

          <Flex direction="column" style={{ flex: 1, minWidth: 0, gap: "1px" }}>
            <Flex align="center" gap="1">
              <Text
                size="2"
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {member.nickname}
              </Text>
              {isSpeaking && (
                <MdVolumeUp
                  size={12}
                  color="var(--accent-9)"
                  style={{ flexShrink: 0 }}
                />
              )}
              {member.isDeafened && (
                <MdVolumeOff size={10} color="var(--red-9)" style={{ flexShrink: 0 }} />
              )}
              {member.isMuted && !member.isDeafened && (
                <MdMicOff size={10} color="var(--red-9)" style={{ flexShrink: 0 }} />
              )}
            </Flex>

            <Text
              size="1"
              style={{ color: statusColor, lineHeight: 1.2 }}
            >
              {statusLabel}
            </Text>
          </Flex>
        </Flex>
      </div>
    </UserContextMenu>
  );
};

export const MemberSidebar = ({
  members,
  currentServerUserId,
  currentUserRole,
  clientsSpeaking,
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
    <Box
      width="240px"
      style={{
        background: "var(--gray-3)",
        borderRadius: "var(--radius-5)",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Flex
        direction="column"
        height="100%"
        p="3"
        gap="1"
      >
        <Box pb="2">
          <Flex align="center" justify="between" gap="2">
            <Text size="2" weight="bold" color="gray">
              Members — {members.length}
            </Text>
            {onTogglePinned && (
              <Tooltip content={pinned ? "Unpin sidebar" : "Pin sidebar"} delayDuration={200}>
                <IconButton
                  size="1"
                  variant={pinned ? "solid" : "soft"}
                  color="gray"
                  onClick={onTogglePinned}
                  aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
                >
                  <MdPushPin size={14} />
                </IconButton>
              </Tooltip>
            )}
          </Flex>
        </Box>

        <Flex direction="column" gap="2" style={{ overflow: "auto", flex: 1 }}>
          {sortedMembers.map((member) => (
            <MemberItem
              key={member.serverUserId}
              member={member}
              isSpeaking={clientsSpeaking[member.serverUserId] || false}
              currentServerUserId={currentServerUserId}
              currentUserRole={currentUserRole}
              serverHost={serverHost}
              adminActions={adminActions}
            />
          ))}
        </Flex>
      </Flex>
    </Box>
  );
};
