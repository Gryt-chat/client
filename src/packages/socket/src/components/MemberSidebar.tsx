import { Avatar, Box,Flex, Text } from "@radix-ui/themes";
import { BsVolumeOffFill } from "react-icons/bs";
import { HiSpeakerWave } from "react-icons/hi2";
import { MdMicOff } from "react-icons/md";

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
}

const getStatusColor = (member: MemberInfo) => {
  switch (member.status) {
    case 'in_voice':
      return "var(--green-9)";
    case 'online':
      return "var(--blue-9)";
    case 'afk':
      return "var(--orange-9)";
    case 'offline':
      return "var(--gray-9)";
    default:
      return "var(--gray-9)";
  }
};

const CategoryHeader = ({ label, count }: { label: string; count: number }) => (
  <Box pt="2" pb="1" px="1">
    <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {label} — {count}
    </Text>
  </Box>
);

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
  const statusColor = getStatusColor(member);
  const isSelf = member.serverUserId === currentServerUserId;

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
          borderRadius: "16px",
          padding: "8px 12px",
          cursor: 'default',
          opacity: member.status === 'offline' ? 0.5 : 1,
        }}
      >
        <Flex align="center" gap="2" width="100%">
          <Flex position="relative">
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
            <Box
              style={{
                position: "absolute",
                bottom: "-2px",
                right: "-2px",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: statusColor,
                border: "2px solid var(--gray-3)",
              }}
            />
          </Flex>

          <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
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
                <HiSpeakerWave
                  size={12}
                  color="var(--accent-9)"
                  style={{ flexShrink: 0 }}
                />
              )}
            </Flex>

            <Flex align="center" gap="1">
              <Flex gap="1" align="center">
                {member.isDeafened && (
                  <BsVolumeOffFill size={10} color="var(--red-9)" />
                )}
                {member.isMuted && !member.isDeafened && (
                  <MdMicOff size={10} color="var(--red-9)" />
                )}
              </Flex>
            </Flex>
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
}: MemberSidebarProps) => {
  const sortAlpha = (a: MemberInfo, b: MemberInfo) => a.nickname.localeCompare(b.nickname);

  const inVoice = members.filter((m) => m.status === 'in_voice').sort(sortAlpha);
  const online = members.filter((m) => m.status === 'online' || m.status === 'afk').sort(sortAlpha);
  const offline = members.filter((m) => m.status === 'offline').sort(sortAlpha);

  const renderMembers = (list: MemberInfo[]) =>
    list.map((member) => (
      <MemberItem
        key={member.serverUserId}
        member={member}
        isSpeaking={clientsSpeaking[member.serverUserId] || false}
        currentServerUserId={currentServerUserId}
        currentUserRole={currentUserRole}
        serverHost={serverHost}
        adminActions={adminActions}
      />
    ));

  return (
    <Box
      width="240px"
      style={{
        background: "var(--gray-3)",
        borderRadius: "12px",
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
          <Text size="2" weight="bold" color="gray">
            Members — {members.length}
          </Text>
        </Box>

        <Flex direction="column" gap="2" style={{ overflow: "auto", flex: 1 }}>
          {inVoice.length > 0 && (
            <>
              <CategoryHeader label="In Voice" count={inVoice.length} />
              {renderMembers(inVoice)}
            </>
          )}

          {online.length > 0 && (
            <>
              <CategoryHeader label="Online" count={online.length} />
              {renderMembers(online)}
            </>
          )}

          {offline.length > 0 && (
            <>
              <CategoryHeader label="Offline" count={offline.length} />
              {renderMembers(offline)}
            </>
          )}
        </Flex>
      </Flex>
    </Box>
  );
};
