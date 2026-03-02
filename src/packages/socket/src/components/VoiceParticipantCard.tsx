import { Avatar, Flex, Text, Tooltip } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { MdMicOff, MdScreenShare, MdVideocam, MdVolumeOff } from "react-icons/md";

import { getUploadsFileUrl } from "@/common";

import type { Client } from "../types/clients";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { SkeletonBase } from "./skeletons";
import { UserContextMenu } from "./UserContextMenu";

type Role = "owner" | "admin" | "mod" | "member";

export interface FocusedStreamInfo {
  itemId: string;
  stream: MediaStream;
  title: string;
  audioStreamId?: string;
  objectFit: "cover" | "contain";
  mirrored?: boolean;
}

interface LatencyDisplayStats {
  estimatedOneWayMs?: number | null;
  networkRttMs?: number | null;
  jitterMs?: number | null;
  codec?: string | null;
  remoteAddress?: string | null;
}

export function VideoCard({
  stream,
  nickname,
  mirrored,
  isSpeaking,
  statusIcons,
  objectFit = "cover",
  onClick,
}: {
  stream: MediaStream;
  nickname: string;
  mirrored?: boolean;
  isSpeaking?: boolean;
  statusIcons?: ReactNode;
  objectFit?: "cover" | "contain";
  onClick?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        borderRadius: "var(--radius-3)",
        overflow: "hidden",
        background: "#000",
        outline: isSpeaking ? "2.5px solid var(--accent-9)" : "2.5px solid transparent",
        transition: "outline-color 0.1s ease",
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit,
          transform: mirrored ? "scaleX(-1)" : undefined,
          pointerEvents: "none",
        }}
      />
      <Flex
        align="center"
        gap="1"
        px="2"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
          padding: "12px 8px 4px",
        }}
      >
        <Text size="1" weight="medium" style={{ color: "#fff" }} truncate>
          {nickname}
        </Text>
        {statusIcons}
      </Flex>
    </div>
  );
}

function latencyColor(ms: number | null): string {
  if (ms === null) return "var(--gray-9)";
  if (ms < 30) return "var(--green-9)";
  if (ms < 80) return "var(--yellow-9)";
  return "var(--red-9)";
}

function LatencyBadge({ stats, isSelf }: { stats: LatencyDisplayStats | undefined; isSelf: boolean }) {
  const oneWay = stats?.estimatedOneWayMs;
  if (oneWay == null) return null;
  const tooltipParts = [
    `RTT: ${stats?.networkRttMs?.toFixed(0) ?? "—"}ms`,
    `Jitter: ${stats?.jitterMs?.toFixed(1) ?? "—"}ms`,
    stats?.codec ?? "—",
  ];
  if (isSelf && stats?.remoteAddress) tooltipParts.push(`ICE: ${stats.remoteAddress}`);
  return (
    <Tooltip content={tooltipParts.join(" · ")}>
      <Text size="1" style={{ color: latencyColor(oneWay), fontVariantNumeric: "tabular-nums", cursor: "default" }}>
        {Math.round(oneWay)}ms
      </Text>
    </Tooltip>
  );
}

export function VoiceParticipantCard({
  itemId,
  compact,
  client,
  isSelf,
  isUserConnecting,
  serverHost,
  avatarFileId,
  cameraMirrored,
  isSpeaking,
  showPeerLatency,
  latencyStats,
  localCameraStream,
  localScreenStream,
  videoStreams,
  onFocus,
  onPopout,
  onDisconnectUser,
  currentUserRole,
  memberInfo,
  adminActions,
}: {
  itemId: string;
  compact?: boolean;
  client: Client;
  isSelf: boolean;
  isUserConnecting: boolean;
  serverHost: string;
  avatarFileId?: string | null;
  cameraMirrored: boolean;
  isSpeaking: boolean;
  showPeerLatency: boolean;
  latencyStats?: LatencyDisplayStats;
  localCameraStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  videoStreams?: Record<string, MediaStream>;
  onFocus: (info: FocusedStreamInfo) => void;
  onPopout: (itemId: string, stream: MediaStream, title: string, audioStreamId?: string) => void;
  onDisconnectUser?: (targetServerUserId: string) => void;
  currentUserRole?: Role;
  memberInfo?: MemberInfo;
  adminActions?: AdminActions;
}) {
  const isScreenTile = itemId.startsWith("screen:");
  const serverUserId: string | undefined = client?.serverUserId;

  if (isScreenTile) {
    const screenStream = isSelf
      ? localScreenStream
      : (client.screenShareVideoStreamID && videoStreams?.[client.screenShareVideoStreamID])
        ? videoStreams[client.screenShareVideoStreamID]
        : null;
    if (!isSelf) {
      const found = !!screenStream;
      console.log(
        `[ScreenShare] VoiceParticipantCard: screenStreamID=${client.screenShareVideoStreamID || "empty"} found=${found} audioStreamID=${client.screenShareAudioStreamID || "empty"} videoStreamKeys=[${Object.keys(videoStreams ?? {}).join(", ")}]`,
      );
    }
    if (!screenStream) return null;
    const screenTitle = isSelf ? "Your Screen" : `${client.nickname}'s Screen`;

    return (
      <UserContextMenu
        serverUserId={serverUserId}
        nickname={client.nickname}
        isSelf={isSelf}
        canDisconnect={!!onDisconnectUser}
        isInVoice={true}
        onDisconnectFromVoice={onDisconnectUser && serverUserId ? () => onDisconnectUser(serverUserId) : undefined}
        role={currentUserRole}
        targetRole={memberInfo?.role}
        isServerMuted={memberInfo?.isServerMuted}
        isServerDeafened={memberInfo?.isServerDeafened}
        onKick={adminActions?.onKickUser && serverUserId ? () => adminActions.onKickUser!(serverUserId) : undefined}
        onBan={adminActions?.onBanUser && serverUserId ? () => adminActions.onBanUser!(serverUserId) : undefined}
        onServerMute={adminActions?.onServerMuteUser && serverUserId ? (muted) => adminActions.onServerMuteUser!(serverUserId, muted) : undefined}
        onServerDeafen={adminActions?.onServerDeafenUser && serverUserId ? (deafened) => adminActions.onServerDeafenUser!(serverUserId, deafened) : undefined}
        onChangeRole={adminActions?.onChangeRole && serverUserId ? (role) => adminActions.onChangeRole!(serverUserId, role) : undefined}
        onPopoutVideo={() => onPopout(itemId, screenStream, screenTitle, (!isSelf && client.screenShareAudioStreamID) || undefined)}
      >
        <VideoCard
          stream={screenStream}
          nickname={screenTitle}
          objectFit="contain"
          statusIcons={<MdScreenShare size={10} color="var(--blue-9)" />}
          onClick={() => onFocus({
            itemId,
            stream: screenStream,
            title: screenTitle,
            audioStreamId: (!isSelf && client.screenShareAudioStreamID) || undefined,
            objectFit: "contain",
          })}
        />
      </UserContextMenu>
    );
  }

  const hasCameraStream =
    (isSelf && localCameraStream) ||
    (!isSelf && client.cameraEnabled && client.cameraStreamID && videoStreams?.[client.cameraStreamID]);

  const statusBadges = (
    <>
      {(client.isMuted || client.isDeafened) && (
        client.isDeafened
          ? <MdVolumeOff size={12} color="var(--red-9)" />
          : <MdMicOff size={12} color="var(--red-9)" />
      )}
      {client.isAFK && <Text size="1" weight="bold" style={{ color: "#fff" }}>AFK</Text>}
      {client.screenShareEnabled && <MdScreenShare size={10} color="var(--blue-9)" />}
    </>
  );

  const cameraView = () => {
    const camStream = isSelf ? localCameraStream! : videoStreams![client.cameraStreamID!];
    return (
      <Flex direction="column" gap="1" align="center" style={{ width: "100%" }}>
        <VideoCard
          stream={camStream}
          nickname={client.nickname}
          mirrored={isSelf ? cameraMirrored : false}
          isSpeaking={isSpeaking}
          statusIcons={statusBadges}
          onClick={() => onFocus({
            itemId,
            stream: camStream,
            title: isSelf ? "Your Camera" : `${client.nickname}'s Camera`,
            objectFit: "cover",
            mirrored: isSelf ? cameraMirrored : false,
          })}
        />
        {!compact && showPeerLatency && <LatencyBadge stats={latencyStats} isSelf={isSelf} />}
      </Flex>
    );
  };

  const avatarView = () => (
    <Flex align="center" justify="center" direction={compact ? "row" : "column"} gap="1" px={compact ? "2" : "4"} py={compact ? "1" : "3"}>
      <Flex align="center" justify="center" position="relative">
        <Avatar
          size={compact ? "2" : "3"}
          fallback={client.nickname[0]}
          src={avatarFileId ? getUploadsFileUrl(serverHost, avatarFileId) : undefined}
          style={{
            outline: "2.5px solid",
            outlineColor: isSpeaking ? "var(--accent-9)" : "transparent",
            transition: "outline-color 0.1s ease",
          }}
        />
        {client.cameraEnabled && (
          <Flex position="absolute" top="-4px" right="-4px" style={{ background: "var(--green-9)", borderRadius: "50%", padding: "2px" }}>
            <MdVideocam size={10} color="white" />
          </Flex>
        )}
        {client.screenShareEnabled && (
          <Flex position="absolute" top="-4px" left="-4px" style={{ background: "var(--blue-9)", borderRadius: "50%", padding: "2px" }}>
            <MdScreenShare size={10} color="white" />
          </Flex>
        )}
        {isUserConnecting && (
          <Flex position="absolute" align="center" justify="center" style={{ top: 0, left: 0, right: 0, bottom: 0, background: "var(--color-panel-translucent)", borderRadius: "50%" }}>
            <SkeletonBase width="24px" height="24px" borderRadius="50%" />
          </Flex>
        )}
        {(client.isMuted || client.isDeafened || client.isAFK) && (
          <Flex position="absolute" bottom="-4px" right="-4px" gap="1" style={{ background: "var(--gray-3)", borderRadius: "var(--radius-4)", padding: "2px 4px", border: "1px solid var(--gray-6)" }}>
            {client.isDeafened ? <MdVolumeOff size={12} color="var(--red-9)" /> : client.isMuted ? <MdMicOff size={12} color="var(--red-9)" /> : null}
            {client.isAFK && <Text size="1" weight="bold" color="orange">AFK</Text>}
          </Flex>
        )}
      </Flex>
      <Flex direction="column" align="center" gap="1">
        <Text size={compact ? "1" : undefined}>{client.nickname}</Text>
        {!compact && showPeerLatency && <LatencyBadge stats={latencyStats} isSelf={isSelf} />}
      </Flex>
    </Flex>
  );

  return (
    <UserContextMenu
      serverUserId={serverUserId}
      nickname={client.nickname}
      isSelf={isSelf}
      canDisconnect={!!onDisconnectUser}
      isInVoice={true}
      onDisconnectFromVoice={onDisconnectUser && serverUserId ? () => onDisconnectUser(serverUserId) : undefined}
      role={currentUserRole}
      targetRole={memberInfo?.role}
      isServerMuted={memberInfo?.isServerMuted}
      isServerDeafened={memberInfo?.isServerDeafened}
      onKick={adminActions?.onKickUser && serverUserId ? () => adminActions.onKickUser!(serverUserId) : undefined}
      onBan={adminActions?.onBanUser && serverUserId ? () => adminActions.onBanUser!(serverUserId) : undefined}
      onServerMute={adminActions?.onServerMuteUser && serverUserId ? (muted) => adminActions.onServerMuteUser!(serverUserId, muted) : undefined}
      onServerDeafen={adminActions?.onServerDeafenUser && serverUserId ? (deafened) => adminActions.onServerDeafenUser!(serverUserId, deafened) : undefined}
      onChangeRole={adminActions?.onChangeRole && serverUserId ? (role) => adminActions.onChangeRole!(serverUserId, role) : undefined}
      onPopoutVideo={(() => {
        const cam = isSelf
          ? localCameraStream
          : (client.cameraEnabled && client.cameraStreamID && videoStreams?.[client.cameraStreamID]) || null;
        if (!cam) return undefined;
        return () => { onPopout(itemId, cam, isSelf ? "Your Camera" : `${client.nickname}'s Camera`); };
      })()}
    >
      {hasCameraStream ? cameraView() : avatarView()}
    </UserContextMenu>
  );
}
