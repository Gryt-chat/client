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
  mutedBadge,
  radius = TILE_RADIUS,
  objectFit = "cover",
  onClick,
  pendingLabel = "Connecting video…",
}: {
  stream: MediaStream | null;
  nickname: string;
  mirrored?: boolean;
  isSpeaking?: boolean;
  statusIcons?: ReactNode;
  mutedBadge?: ReactNode;
  radius?: number;
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
        borderRadius: radius,
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

      {mutedBadge}

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
 *
 * `avatarColor` on the member is the better source where it exists — see
 * hueFromAvatarColor.
 */
const TILE_HUES = [280, 24, 170, 330, 210, 140, 350, 45, 260, 195];

/** Measured off Meet. Overridable so the two-participant PiP can sit at 12. */
export const TILE_RADIUS = 16;

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
 * The palette entry nearest the avatar's own colour.
 *
 * Snapped rather than used directly, for the same reason hueFromId picks from a
 * list: the tile is drawn at a fixed lightness and saturation, and an arbitrary
 * hue put through those lands in the olive band often enough to look broken.
 * Snapping keeps the person's colour recognisable while every tile stays a
 * colour the panel was designed around.
 *
 * Returns null rather than a hue for anything the snap would misrepresent — a
 * malformed value, or a grey avatar, whose hue is whatever rounding noise it
 * happens to carry. The caller falls back to the id hash, which is what every
 * tile looked like before this existed.
 */
function hueFromAvatarColor(hex: string | null | undefined): number | null {
  if (!hex) return null;

  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // Near-grey. Below this the hue is noise, and snapping it would hand someone
  // a saturated tile that has nothing to do with their avatar.
  if (delta < 0.08) return null;

  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;

  hue = (hue * 60 + 360) % 360;

  let nearest = TILE_HUES[0];
  let best = Infinity;
  for (const candidate of TILE_HUES) {
    // Around the wheel, so 350 and 24 are 34 apart rather than 326.
    const diff = Math.abs(((candidate - hue + 540) % 360) - 180);
    if (diff < best) {
      best = diff;
      nearest = candidate;
    }
  }
  return nearest;
}

function tileHue(id: string, avatarColor?: string | null): number {
  return hueFromAvatarColor(avatarColor) ?? hueFromId(id);
}

/**
 * Meet's tiles are a lighter centre falling off to a deeper edge. Two stops of
 * the same hue rather than a flat fill — flat reads as a coloured rectangle,
 * the falloff reads as a tile with someone in it.
 */
function tileGradient(id: string, avatarColor?: string | null): string {
  const h = tileHue(id, avatarColor);
  return `radial-gradient(circle at 50% 42%, hsl(${h} 48% 42%), hsl(${h} 55% 20%) 75%)`;
}

/**
 * The muted badge, top-right of the tile.
 *
 * Meet tints this to the tile's own hue rather than using a neutral chip, so it
 * reads as part of the tile instead of an overlay. On a video tile there is no
 * hue to borrow — the tile is the camera image — so it falls back to a dark
 * translucent circle, which is what Meet does there too.
 *
 * The diameter is not measured. It steps at the same tile height as the avatar
 * buckets so the two stay in proportion.
 */
function MutedBadge({
  hueId,
  hueAvatarColor,
  deafened,
  tileHeight,
}: {
  hueId?: string;
  hueAvatarColor?: string | null;
  deafened: boolean;
  tileHeight: number;
}) {
  const size = tileHeight >= 170 ? 28 : 20;

  return (
    <Flex
      align="center"
      justify="center"
      style={{
        position: "absolute",
        top: 12,
        right: 12,
        width: size,
        height: size,
        borderRadius: "50%",
        background: hueId
          ? `hsl(${tileHue(hueId, hueAvatarColor)} 45% 26%)`
          : "rgba(0, 0, 0, 0.6)",
        pointerEvents: "none",
      }}
    >
      {deafened ? (
        <MdVolumeOff size={Math.round(size * 0.55)} color="#fff" />
      ) : (
        <MdMicOff size={Math.round(size * 0.55)} color="#fff" />
      )}
    </Flex>
  );
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
  if (height >= SMALL_TILE_HEIGHT) return 48;
  return 32;
}

/**
 * Below this height a tile cannot carry a centred avatar and a 16px name row
 * without the two overlapping. The two-participant picture-in-picture is the
 * case that hits it — at 16:9 in a sidebar-width panel it comes out around
 * 80px tall — so the avatar, the name and its inset all step down together.
 */
const SMALL_TILE_HEIGHT = 110;

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
  tileRadius = TILE_RADIUS,
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
  /** Overridden to 12 for the two-participant picture-in-picture tile. */
  tileRadius?: number;
}) {
  const isScreenTile = itemId.startsWith("screen:");
  const serverUserId: string | undefined = client?.serverUserId;

  // Above the screen-tile branch below, which returns early. A hook after an
  // early return only survives because a given card keeps the same itemId for
  // its whole life, which is not something to rely on.
  const tileRef = useRef<HTMLDivElement>(null);
  const tileHeight = useTileHeight(tileRef);

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
          radius={tileRadius}
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
      {/* Mute and deafen are the top-right badge now, not an icon in the name
          row. Everything else still belongs beside the name. */}
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

      {/* Beside the name, the way the avatar tile does it. It used to sit
          under the tile as a sibling, which meant the tile could not be given
          a definite height. */}
      {!compact && showPeerLatency && (
        <LatencyBadge stats={latencyStats} isSelf={isSelf} />
      )}
    </>
  );

  const avatarPx = avatarSizeForHeight(tileHeight);

  const showMutedBadge =
    !compact && (client.isMuted || client.isDeafened) && !isUserConnecting;

  const isSmallTile =
    !compact && tileHeight > 0 && tileHeight < SMALL_TILE_HEIGHT;

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
              borderRadius: tileRadius,
              overflow: "hidden",
              background: tileGradient(
                client.serverUserId || client.nickname,
                memberInfo?.avatarColor,
              ),
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

        {/* Mute state moved to the tile's top-right badge, so this chip is
            only still carrying it in the compact strip, which has no tile to
            hang a badge on. */}
        {((compact && (client.isMuted || client.isDeafened)) ||
          client.isAFK) && (
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
            {compact && client.isDeafened ? (
              <MdVolumeOff size={12} color="var(--red-9)" />
            ) : compact && client.isMuted ? (
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

      {showMutedBadge && (
        <MutedBadge
          hueId={client.serverUserId || client.nickname}
          hueAvatarColor={memberInfo?.avatarColor}
          deafened={!!client.isDeafened}
          tileHeight={tileHeight}
        />
      )}

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
            bottom: isSmallTile ? 6 : 9,
            left: isSmallTile ? 8 : 12,
            right: isSmallTile ? 8 : 12,
            minWidth: 0,
          }}
        >
          <Text
            weight="medium"
            style={{
              color: "#fff",
              fontSize: isSmallTile ? 12 : 16,
              lineHeight: 1.2,
            }}
            truncate
          >
            {client.nickname}
          </Text>
          {/* The latency figure is the first thing to go when there is no room
              for it — the name has to survive, the number does not. */}
          {showPeerLatency && !isSmallTile && (
            <LatencyBadge stats={latencyStats} isSelf={isSelf} />
          )}
        </Flex>
      )}
    </div>
  );

  const cameraView = () => {
    if (!shouldShowCameraTile) return avatarView();

    return (
      <div
        ref={tileRef}
        // Height as well as width: the card fills the cell the grid gives it,
        // and without a definite height here VideoCard's own `height: 100%`
        // resolves against an auto-height parent and collapses.
        style={{ width: "100%", height: "100%" }}
      >
        <VideoCard
          key={`${itemId}:${cameraStreamID || "local"}:${cameraStream?.id || "pending"}`}
          stream={cameraStream}
          nickname={client.nickname}
          mirrored={isSelf ? cameraMirrored : false}
          isSpeaking={isSpeaking}
          statusIcons={statusBadges}
          radius={tileRadius}
          mutedBadge={
            showMutedBadge ? (
              <MutedBadge deafened={!!client.isDeafened} tileHeight={tileHeight} />
            ) : undefined
          }
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
      </div>
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
