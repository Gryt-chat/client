import { Avatar, Flex, Text, Tooltip } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  MdMicOff,
  MdScreenShare,
  MdVideocam,
  MdVolumeOff,
} from "react-icons/md";

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
  pendingLabel = "Connecting video…",
}: {
  stream: MediaStream | null;
  nickname: string;
  mirrored?: boolean;
  isSpeaking?: boolean;
  statusIcons?: ReactNode;
  objectFit?: "cover" | "contain";
  onClick?: () => void;
  pendingLabel?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    if (!stream) {
      if (video.srcObject) video.srcObject = null;
      return;
    }

    if (video.srcObject !== stream) {
      video.srcObject = stream;

      const tracks = stream.getVideoTracks();
      console.log(
        `[VideoCard] srcObject set, stream=${stream.id}, tracks=${tracks.length}, live=${
          tracks.filter((t) => t.readyState === "live").length
        }`,
      );
    }

    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    void video.play().catch((error) => {
      console.warn("[VideoCard] play() failed", error);
    });
  }, [stream]);

  return (
    <div
      onClick={stream ? onClick : undefined}
      style={{
        position: "relative",
        width: "100%",
        // Fills the box the grid gives it. The old `aspectRatio: 16/9` is why
        // tiles never filled the panel — they were letterboxed inside their
        // cell regardless of how much room there was.
        height: "100%",
        borderRadius: 16,
        overflow: "hidden",
        background: "#000",
        outline: isSpeaking
          ? "2.5px solid var(--accent-9)"
          : "2.5px solid transparent",
        transition: "outline-color 0.1s ease",
        cursor: stream && onClick ? "pointer" : undefined,
      }}
    >
      {stream ? (
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
      ) : (
        <Flex
          align="center"
          justify="center"
          style={{
            width: "100%",
            height: "100%",
            color: "var(--gray-10)",
            background: "var(--gray-3)",
          }}
        >
          <Text size="1" color="gray">
            {pendingLabel}
          </Text>
        </Flex>
      )}

      <Flex
        align="center"
        gap="1"
        px="2"
        style={{
          position: "absolute",
          // 12px in, 9px up — measured off Meet. The dark scrim that used to
          // sit behind this is gone: the tile's own colour carries the
          // contrast, and the gradient was the most obviously un-Meet-like
          // thing about the old tile.
          bottom: 9,
          left: 12,
          right: 12,
          padding: 0,
        }}
      >
        <Text
          size="3"
          weight="medium"
          style={{ color: "#fff", fontSize: 16, lineHeight: 1.2 }}
          truncate
        >
          {nickname}
        </Text>
        {statusIcons}
      </Flex>
    </div>
  );
}

/**
 * A stable hue per person, derived from their id.
 *
 * The server does send a per-user `color`, but the client overwrites every one
 * of them with a flat gray in the members:list handler, so there is nothing
 * usable to read. Deriving it here means the same person is the same colour on
 * every client without the server having to agree, and it cannot drift out of
 * sync with whatever the sidebar decides to do.
 */
const TILE_HUES = [280, 24, 170, 330, 210, 140, 350, 45, 260, 195];

function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  // A curated set rather than the full wheel. Free hue lands in the yellow-green
  // band often enough to matter, and those come out muddy at the lightness a
  // tile needs. Meet's own tiles are clearly drawn from a fixed palette too.
  return TILE_HUES[Math.abs(hash) % TILE_HUES.length];
}

/**
 * Meet's tiles are a lighter centre falling off to a deeper edge. Two stops of
 * the same hue rather than a flat fill — flat reads as a coloured rectangle,
 * the falloff reads as a tile with someone in it.
 */
function tileGradient(id: string): string {
  const h = hueFromId(id);
  return `radial-gradient(circle at 50% 42%, hsl(${h} 48% 42%), hsl(${h} 55% 20%) 75%)`;
}

/**
 * Avatar diameter for a tile of this height.
 *
 * Measured off Meet, and it is stepped rather than proportional: a 468-wide
 * spanning tile and a 228-wide grid tile both showed 72px at the same 297px
 * height, which rules out scaling by width, and 24% / 16% / 36% of height for
 * the three observed sizes rules out a single ratio.
 */
function avatarSizeForHeight(height: number): number {
  if (height >= 450) return 96;
  if (height >= 170) return 72;
  return 48;
}

/** Tile height, so the avatar can pick its bucket. */
function useTileHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return height;
}

function latencyColor(ms: number | null): string {
  if (ms === null) return "var(--gray-9)";
  if (ms < 30) return "var(--green-9)";
  if (ms < 80) return "var(--yellow-9)";
  return "var(--red-9)";
}

function LatencyBadge({
  stats,
  isSelf,
}: {
  stats: LatencyDisplayStats | undefined;
  isSelf: boolean;
}) {
  const oneWay = stats?.estimatedOneWayMs;
  if (oneWay == null) return null;

  const tooltipParts = [
    `RTT: ${stats?.networkRttMs?.toFixed(0) ?? "—"}ms`,
    `Jitter: ${stats?.jitterMs?.toFixed(1) ?? "—"}ms`,
    stats?.codec ?? "—",
  ];

  if (isSelf && stats?.remoteAddress) {
    tooltipParts.push(`ICE: ${stats.remoteAddress}`);
  }

  return (
    <Tooltip content={tooltipParts.join(" · ")}>
      <Text
        size="1"
        style={{
          color: latencyColor(oneWay),
          fontVariantNumeric: "tabular-nums",
          cursor: "default",
        }}
      >
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
  fallbackCameraStreamID,
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
  fallbackCameraStreamID?: string | null;
  onFocus: (info: FocusedStreamInfo) => void;
  onPopout: (
    itemId: string,
    stream: MediaStream,
    title: string,
    audioStreamId?: string,
  ) => void;
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
      : client.screenShareVideoStreamID &&
          videoStreams?.[client.screenShareVideoStreamID]
        ? videoStreams[client.screenShareVideoStreamID]
        : null;

    if (!isSelf) {
      const vsKeys = videoStreams ? Object.keys(videoStreams) : [];
      console.log(
        `[ScreenShare] VoiceParticipantCard screen tile: nick=${client.nickname} streamID=${
          client.screenShareVideoStreamID
        } found=${!!screenStream} videoStreamKeys=[${vsKeys.join(",")}]`,
      );
    }

    const hasPendingRemoteScreen =
      !isSelf && client.screenShareEnabled && !!client.screenShareVideoStreamID;

    if (!screenStream && !hasPendingRemoteScreen) return null;

    const screenTitle = isSelf ? "Your Screen" : `${client.nickname}'s Screen`;

    return (
      <UserContextMenu
        serverUserId={serverUserId}
        nickname={client.nickname}
        isSelf={isSelf}
        canDisconnect={!!onDisconnectUser}
        isInVoice={true}
        onDisconnectFromVoice={
          onDisconnectUser && serverUserId
            ? () => onDisconnectUser(serverUserId)
            : undefined
        }
        role={currentUserRole}
        targetRole={memberInfo?.role}
        isServerMuted={memberInfo?.isServerMuted}
        isServerDeafened={memberInfo?.isServerDeafened}
        onKick={
          adminActions?.onKickUser && serverUserId
            ? () => adminActions.onKickUser!(serverUserId)
            : undefined
        }
        onBan={
          adminActions?.onBanUser && serverUserId
            ? () => adminActions.onBanUser!(serverUserId)
            : undefined
        }
        onServerMute={
          adminActions?.onServerMuteUser && serverUserId
            ? (muted) => adminActions.onServerMuteUser!(serverUserId, muted)
            : undefined
        }
        onServerDeafen={
          adminActions?.onServerDeafenUser && serverUserId
            ? (deafened) =>
                adminActions.onServerDeafenUser!(serverUserId, deafened)
            : undefined
        }
        onChangeRole={
          adminActions?.onChangeRole && serverUserId
            ? (role) => adminActions.onChangeRole!(serverUserId, role)
            : undefined
        }
        onPopoutVideo={
          screenStream
            ? () =>
                onPopout(
                  itemId,
                  screenStream,
                  screenTitle,
                  (!isSelf && client.screenShareAudioStreamID) || undefined,
                )
            : undefined
        }
      >
        <VideoCard
          key={`${itemId}:${client.screenShareVideoStreamID || "local"}:${
            screenStream?.id || "pending"
          }`}
          stream={screenStream}
          nickname={screenTitle}
          objectFit="contain"
          pendingLabel="Connecting screen…"
          statusIcons={<MdScreenShare size={10} color="var(--blue-9)" />}
          onClick={
            screenStream
              ? () =>
                  onFocus({
                    itemId,
                    stream: screenStream,
                    title: screenTitle,
                    audioStreamId:
                      (!isSelf && client.screenShareAudioStreamID) || undefined,
                    objectFit: "contain",
                  })
              : undefined
          }
        />
      </UserContextMenu>
    );
  }

  const cameraStreamID = !isSelf
    ? client.cameraStreamID || fallbackCameraStreamID || undefined
    : undefined;

  const cameraStream = isSelf
    ? localCameraStream
    : cameraStreamID && videoStreams?.[cameraStreamID]
      ? videoStreams[cameraStreamID]
      : null;

  const shouldShowCameraTile = isSelf
    ? Boolean(localCameraStream)
    : Boolean(
        client.cameraEnabled || client.cameraStreamID || fallbackCameraStreamID,
      );

  if (!isSelf && shouldShowCameraTile && !cameraStream) {
    const vsKeys = videoStreams ? Object.keys(videoStreams) : [];
    console.warn("[VoiceParticipantCard] Camera pending", {
      nickname: client.nickname,
      cameraEnabled: client.cameraEnabled,
      cameraStreamID: client.cameraStreamID,
      fallbackCameraStreamID,
      videoStreamKeys: vsKeys,
    });
  }

  const statusBadges = (
    <>
      {(client.isMuted || client.isDeafened) &&
        (client.isDeafened ? (
          <MdVolumeOff size={12} color="var(--red-9)" />
        ) : (
          <MdMicOff size={12} color="var(--red-9)" />
        ))}

      {client.isAFK && (
        <Text size="1" weight="bold" style={{ color: "#fff" }}>
          AFK
        </Text>
      )}

      {(client.cameraEnabled || fallbackCameraStreamID) && (
        <MdVideocam size={10} color="var(--green-9)" />
      )}

      {client.screenShareEnabled && (
        <MdScreenShare size={10} color="var(--blue-9)" />
      )}
    </>
  );

  const tileRef = useRef<HTMLDivElement>(null);
  const avatarPx = avatarSizeForHeight(useTileHeight(tileRef));

  const avatarView = () => (
    <div
      ref={tileRef}
      style={
        compact
          ? {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "4px 8px",
            }
          : {
              // The tile itself, rather than an avatar floating on the panel
              // background. This branch renders whenever someone has no video,
              // which is most of the time, and it previously had no tile chrome
              // at all — that is why the panel looked empty.
              position: "relative",
              width: "100%",
              height: "100%",
              borderRadius: 16,
              overflow: "hidden",
              background: tileGradient(client.serverUserId || client.nickname),
              outline: isSpeaking
                ? "2.5px solid var(--accent-9)"
                : "2.5px solid transparent",
              transition: "outline-color 0.1s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }
      }
    >
      <Flex align="center" justify="center" position="relative">
        <Avatar
          size={compact ? "2" : "3"}
          fallback={client.nickname[0]}
          src={
            avatarFileId
              ? getUploadsFileUrl(serverHost, avatarFileId)
              : undefined
          }
          style={{
            outline: "2.5px solid",
            outlineColor: isSpeaking ? "var(--accent-9)" : "transparent",
            transition: "outline-color 0.1s ease",
            // Stepped by tile height rather than Radix's size scale, so the
            // avatar tracks the tile the way Meet's does.
            ...(compact ? {} : { width: avatarPx, height: avatarPx }),
          }}
        />

        {(client.cameraEnabled || fallbackCameraStreamID) && (
          <Flex
            position="absolute"
            top="-4px"
            right="-4px"
            style={{
              background: "var(--green-9)",
              borderRadius: "50%",
              padding: "2px",
            }}
          >
            <MdVideocam size={10} color="white" />
          </Flex>
        )}

        {client.screenShareEnabled && (
          <Flex
            position="absolute"
            top="-4px"
            left="-4px"
            style={{
              background: "var(--blue-9)",
              borderRadius: "50%",
              padding: "2px",
            }}
          >
            <MdScreenShare size={10} color="white" />
          </Flex>
        )}

        {isUserConnecting && (
          <Flex
            position="absolute"
            align="center"
            justify="center"
            style={{
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "var(--color-panel-translucent)",
              borderRadius: "50%",
            }}
          >
            <SkeletonBase width="24px" height="24px" borderRadius="50%" />
          </Flex>
        )}

        {(client.isMuted || client.isDeafened || client.isAFK) && (
          <Flex
            position="absolute"
            bottom="-4px"
            right="-4px"
            gap="1"
            style={{
              background: "var(--gray-3)",
              borderRadius: "var(--radius-4)",
              padding: "2px 4px",
              border: "1px solid var(--gray-6)",
            }}
          >
            {client.isDeafened ? (
              <MdVolumeOff size={12} color="var(--red-9)" />
            ) : client.isMuted ? (
              <MdMicOff size={12} color="var(--red-9)" />
            ) : null}

            {client.isAFK && (
              <Text size="1" weight="bold" color="orange">
                AFK
              </Text>
            )}
          </Flex>
        )}
      </Flex>

      {compact ? (
        <Text size="1">{client.nickname}</Text>
      ) : (
        <Flex
          align="center"
          gap="2"
          style={{
            // Bottom-left, 12 in and 9 up, measured off Meet. No scrim — the
            // tile's own colour carries the contrast.
            position: "absolute",
            bottom: 9,
            left: 12,
            right: 12,
            minWidth: 0,
          }}
        >
          <Text
            weight="medium"
            style={{ color: "#fff", fontSize: 16, lineHeight: 1.2 }}
            truncate
          >
            {client.nickname}
          </Text>
          {showPeerLatency && (
            <LatencyBadge stats={latencyStats} isSelf={isSelf} />
          )}
        </Flex>
      )}
    </div>
  );

  const cameraView = () => {
    if (!shouldShowCameraTile) return avatarView();

    return (
      <Flex direction="column" gap="1" align="center" style={{ width: "100%" }}>
        <VideoCard
          key={`${itemId}:${cameraStreamID || "local"}:${cameraStream?.id || "pending"}`}
          stream={cameraStream}
          nickname={client.nickname}
          mirrored={isSelf ? cameraMirrored : false}
          isSpeaking={isSpeaking}
          statusIcons={statusBadges}
          pendingLabel="Connecting video…"
          onClick={
            cameraStream
              ? () =>
                  onFocus({
                    itemId,
                    stream: cameraStream,
                    title: isSelf
                      ? "Your Camera"
                      : `${client.nickname}'s Camera`,
                    objectFit: "cover",
                    mirrored: isSelf ? cameraMirrored : false,
                  })
              : undefined
          }
        />

        {!compact && showPeerLatency && (
          <LatencyBadge stats={latencyStats} isSelf={isSelf} />
        )}
      </Flex>
    );
  };

  return (
    <UserContextMenu
      serverUserId={serverUserId}
      nickname={client.nickname}
      isSelf={isSelf}
      canDisconnect={!!onDisconnectUser}
      isInVoice={true}
      onDisconnectFromVoice={
        onDisconnectUser && serverUserId
          ? () => onDisconnectUser(serverUserId)
          : undefined
      }
      role={currentUserRole}
      targetRole={memberInfo?.role}
      isServerMuted={memberInfo?.isServerMuted}
      isServerDeafened={memberInfo?.isServerDeafened}
      onKick={
        adminActions?.onKickUser && serverUserId
          ? () => adminActions.onKickUser!(serverUserId)
          : undefined
      }
      onBan={
        adminActions?.onBanUser && serverUserId
          ? () => adminActions.onBanUser!(serverUserId)
          : undefined
      }
      onServerMute={
        adminActions?.onServerMuteUser && serverUserId
          ? (muted) => adminActions.onServerMuteUser!(serverUserId, muted)
          : undefined
      }
      onServerDeafen={
        adminActions?.onServerDeafenUser && serverUserId
          ? (deafened) =>
              adminActions.onServerDeafenUser!(serverUserId, deafened)
          : undefined
      }
      onChangeRole={
        adminActions?.onChangeRole && serverUserId
          ? (role) => adminActions.onChangeRole!(serverUserId, role)
          : undefined
      }
      onPopoutVideo={
        cameraStream
          ? () =>
              onPopout(
                itemId,
                cameraStream,
                isSelf ? "Your Camera" : `${client.nickname}'s Camera`,
              )
          : undefined
      }
    >
      {cameraView()}
    </UserContextMenu>
  );
}
