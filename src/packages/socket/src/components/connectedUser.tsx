import { Avatar, Tooltip } from "@gryt/ui";
import { motion } from "motion/react";
import { PiMicrophoneSlashFill, PiScreencastFill, PiSpeakerSlashFill, PiVideoCameraFill } from "react-icons/pi";

import { SkeletonBase } from "./skeletons";
import { SpeakingHalo } from "./SpeakingHalo";
import {
  speakingRingStyle,
  tileHue,
} from "./speakingIndicator";
import { UserContextMenu } from "./UserContextMenu";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

/** Radix Avatar size="1". The halo has to be told the box it grows from. */
const SIDEBAR_AVATAR_PX = 24;

/** Thinner than the tile's 2.5px — the row is a fraction of the height. */
const SIDEBAR_RING = 2;

export function ConnectedUser({
  isSpeaking,
  avatarColor,
  avatarWorn,
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
  serverHost,
}: {
  isSpeaking: boolean;
  /** Dominant colour of the avatar, so the ring matches the voice tile's. */
  avatarColor?: string | null;
  /** Their owl's design, which beats the sampled colour above. See tileHue. */
  avatarWorn?: string | null;
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
  serverHost?: string;
}) {
  const hue = tileHue(nickname, avatarColor, { nickname, worn: avatarWorn });

  return (
    <UserContextMenu
      serverHost={serverHost}
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
      <div className="flex gap-2 items-center px-3 py-2 w-full" style={{
          opacity: 1,
          transition: "opacity 0.3s ease",
        }}>
        <div className="flex gap-2 items-center" style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center justify-center relative" style={{ flexShrink: 0 }}>
            <SpeakingHalo
              analyser={speakingAnalyser}
              hue={hue}
              size={SIDEBAR_AVATAR_PX}
            />
            <Avatar
              size="small"
              className="h-6 w-6 text-[10px]"
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
          </div>
          <span className="text-sm truncate" style={{ whiteSpace: "nowrap" }}>{nickname}</span>
        </div>

        <div className="flex gap-1 items-center" style={{ flexShrink: 0 }}>
          {isConnectingToVoice && (
            <SkeletonBase width="12px" height="12px" borderRadius="50%" />
          )}
          {screenShareEnabled && (
            <Tooltip title="Streaming">
              <div className="flex items-center">
                <PiScreencastFill size={14} color="var(--gryt-accent-9)" />
              </div>
            </Tooltip>
          )}
          {cameraEnabled && (
            <Tooltip title="Camera on">
              <div className="flex items-center">
                <PiVideoCameraFill size={14} color="var(--gryt-accent-9)" />
              </div>
            </Tooltip>
          )}
          {isDeafened ? (
            <PiSpeakerSlashFill size={14} color="var(--gryt-danger-8)" />
          ) : isMuted ? (
            <PiMicrophoneSlashFill size={14} color="var(--gryt-danger-8)" />
          ) : null}
          {isAFK && (
            <span className="text-xs font-bold text-gryt-warning">
              AFK
            </span>
          )}
        </div>
      </div>
    </motion.div>
    </UserContextMenu>
  );
}
