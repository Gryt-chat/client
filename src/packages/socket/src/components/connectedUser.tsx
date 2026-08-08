import { Avatar, Flex, Text, Tooltip } from "@radix-ui/themes";
import { motion } from "motion/react";
import { MdMicOff, MdScreenShare, MdVideocam, MdVolumeOff } from "react-icons/md";

import { SkeletonBase } from "./skeletons";
import { SpeakingHalo } from "./SpeakingHalo";
import {
  speakingRingStyle,
  tileHue,
} from "./speakingIndicator";
import { UserContextMenu } from "./UserContextMenu";

type Role = "owner" | "admin" | "mod" | "member";

/** Radix Avatar size="1". The halo has to be told the box it grows from. */
const SIDEBAR_AVATAR_PX = 24;

/** Thinner than the tile's 2.5px — the row is a fraction of the height. */
const SIDEBAR_RING = 2;

export function ConnectedUser({
  isSpeaking,
  avatarColor,
  speakingAnalyser,
  isMuted,
  isDeafened,
  isAFK,
  nickname,
  avatarSrc,
  serverUserId,
  isSelf,
  isConnectingToVoice = false,
  screenShareEnabled,
  cameraEnabled,
  canDisconnect,
  onDisconnectFromVoice,
  role,
  targetRole,
  isServerMuted,
  isServerDeafened,
  onKick,
  onBan,
  onServerMute,
  onServerDeafen,
  onChangeRole,
}: {
  isSpeaking: boolean;
  /** Dominant colour of the avatar, so the ring matches the voice tile's. */
  avatarColor?: string | null;
  /** The same analyser the tile's halo reads. */
  speakingAnalyser?: AnalyserNode;
  isMuted: boolean;
  isDeafened: boolean;
  isAFK: boolean;
  nickname: string;
  avatarSrc?: string;
  serverUserId?: string;
  isSelf?: boolean;
  isConnectedToVoice?: boolean;
  isConnectingToVoice?: boolean;
  screenShareEnabled?: boolean;
  cameraEnabled?: boolean;
  canDisconnect?: boolean;
  onDisconnectFromVoice?: () => void;
  role?: Role;
  targetRole?: Role;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  onKick?: () => void;
  onBan?: () => void;
  onServerMute?: (muted: boolean) => void;
  onServerDeafen?: (deafened: boolean) => void;
  onChangeRole?: (role: Role) => void;
}) {
  const hue = tileHue(nickname, avatarColor);

  return (
    <UserContextMenu
      serverUserId={serverUserId}
      nickname={nickname}
      isSelf={isSelf}
      canDisconnect={canDisconnect}
      isInVoice={true}
      onDisconnectFromVoice={onDisconnectFromVoice}
      role={role}
      targetRole={targetRole}
      isServerMuted={isServerMuted}
      isServerDeafened={isServerDeafened}
      onKick={onKick}
      onBan={onBan}
      onServerMute={onServerMute}
      onServerDeafen={onServerDeafen}
      onChangeRole={onChangeRole}
    >
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      style={{ width: "100%", overflow: "hidden" }}
    >
      <Flex
        gap="2"
        align="center"
        px="3"
        py="2"
        width="100%"
        style={{
          opacity: 1,
          transition: "opacity 0.3s ease",
        }}
      >
        <Flex gap="2" align="center" style={{ flex: 1, minWidth: 0 }}>
          <Flex
            align="center"
            justify="center"
            position="relative"
            style={{ flexShrink: 0 }}
          >
            <SpeakingHalo
              analyser={speakingAnalyser}
              hue={hue}
              size={SIDEBAR_AVATAR_PX}
            />
            <Avatar
              radius="full"
              size="1"
              fallback={nickname[0]}
              src={avatarSrc}
              style={{
                flexShrink: 0,
                // Same ring the voice tile draws, at the width this row has
                // room for. Sharing speakingRingStyle is the point: the two
                // used to disagree about colour and thickness while reading
                // the same clientsSpeaking record.
                ...speakingRingStyle(hue, isSpeaking, SIDEBAR_RING),
              }}
            />
          </Flex>
          <Text size="2" truncate style={{ whiteSpace: "nowrap" }}>{nickname}</Text>
        </Flex>

        <Flex gap="1" align="center" style={{ flexShrink: 0 }}>
          {isConnectingToVoice && (
            <SkeletonBase width="12px" height="12px" borderRadius="50%" />
          )}
          {screenShareEnabled && (
            <Tooltip content="Streaming">
              <Flex align="center">
                <MdScreenShare size={14} color="var(--accent-9)" />
              </Flex>
            </Tooltip>
          )}
          {cameraEnabled && (
            <Tooltip content="Camera on">
              <Flex align="center">
                <MdVideocam size={14} color="var(--accent-9)" />
              </Flex>
            </Tooltip>
          )}
          {isDeafened ? (
            <MdVolumeOff size={14} color="var(--red-8)" />
          ) : isMuted ? (
            <MdMicOff size={14} color="var(--red-8)" />
          ) : null}
          {isAFK && (
            <Text size="1" weight="bold" color="orange">
              AFK
            </Text>
          )}
        </Flex>
      </Flex>
    </motion.div>
    </UserContextMenu>
  );
}
