import { Avatar, Tooltip } from "@gryt/ui";
import type { StreamSources } from "@gryt/voice";
import { useMicrophone } from "@gryt/voice";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { PiMicrophoneSlashFill, PiScreencastFill, PiSpeakerSlashFill, PiVideoCameraFill } from "react-icons/pi";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { toObjectPosition, useVideoFraming } from "../hooks/useVideoFraming";
import type { Client } from "../types/clients";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { SkeletonBase } from "./skeletons";
import { SpeakingHalo } from "./SpeakingHalo";
import {
  SPEAKING_RING,
  speakingRingStyle,
  tileGradient,
  tileHue,
} from "./speakingIndicator";
import { UserContextMenu } from "./UserContextMenu";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

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

/**
 * How long a tile waits for its stream before it stops calling itself
 * "connecting". Well past a slow negotiation — offer, answer, ICE and the first
 * RTP on a poor link is a few seconds — and well short of forever.
 */
const VIDEO_PENDING_TIMEOUT_MS = 15_000;

export function VideoCard({
  stream,
  nickname,
  mirrored,
  isSpeaking,
  statusIcons,
  mutedBadge,
  radius = TILE_RADIUS,
  objectFit = "cover",
  objectPosition,
  onClick,
  pendingLabel = "Connecting video…",
  stalledLabel = "Video isn't coming through",
}: {
  stream: MediaStream | null;
  nickname: string;
  mirrored?: boolean;
  isSpeaking?: boolean;
  statusIcons?: ReactNode;
  mutedBadge?: ReactNode;
  radius?: number;
  objectFit?: "cover" | "contain";
  /** Where the crop sits, when the sender has published where their face is. */
  objectPosition?: string;
  onClick?: () => void;
  pendingLabel?: string;
  /** Shown instead of `pendingLabel` once the stream is overdue. */
  stalledLabel?: string;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [isStalled, setIsStalled] = useState(false);

  // A tile with no stream used to say "Connecting video…" for as long as the
  // window stayed open. When the media genuinely never arrives — the SFU never
  // learned about the track, the subscription never produced RTP — that reads
  // as slow rather than broken, and there is nothing to act on. Say so instead.
  useEffect(() => {
    if (stream) {
      setIsStalled(false);
      return;
    }

    const timer = setTimeout(() => setIsStalled(true), VIDEO_PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [stream]);

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
          ? `${SPEAKING_RING}px solid var(--gryt-accent-9)`
          : `${SPEAKING_RING}px solid transparent`,
        // Inward, because the tile fills its cell exactly. An outline is drawn
        // outside the border box, so at offset 0 the ring lands in the gap
        // between tiles or gets clipped by the panel edge.
        outlineOffset: -SPEAKING_RING,
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
            objectPosition,
            // Easing the crop rather than jumping it. The published value is
            // already smoothed, but the first one after a reconnect can land
            // a long way from centre.
            transition: "object-position 400ms ease-out",
            transform: mirrored ? "scaleX(-1)" : undefined,
            pointerEvents: "none",
          }}
        />
      ) : (
        <div className="flex items-center justify-center px-2" style={{
            width: "100%",
            height: "100%",
            color: "var(--gryt-neutral-10)",
            background: "var(--gryt-neutral-3)",
          }}>
          <span
            className={`text-xs text-center ${isStalled ? "" : "text-gryt-muted"}`}
            style={{
              // Step 11, not the 9 the warning icons elsewhere use: 9 is the
              // solid fill and it is barely legible as text on a light theme.
              color: isStalled ? "var(--gryt-warning-11)" : undefined,
            }}
          >
            {isStalled ? stalledLabel : pendingLabel}
          </span>
        </div>
      )}

      {mutedBadge}

      <div className="flex items-center gap-1 px-2" style={{
          position: "absolute",
          // 12px in, 9px up — measured off Meet. The dark scrim that used to
          // sit behind this is gone: the tile's own colour carries the
          // contrast, and the gradient was the most obviously un-Meet-like
          // thing about the old tile.
          bottom: 9,
          left: 12,
          right: 12,
          padding: 0,
        }}>
        <span className="text-base font-medium truncate" style={{ color: "#fff", fontSize: 16, lineHeight: 1.2 }}>
          {nickname}
        </span>
        {statusIcons}
      </div>
    </div>
  );
}

/** Measured off Meet. Overridable so the two-participant PiP can sit at 12. */
export const TILE_RADIUS = 16;

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
    <div className="flex items-center justify-center" style={{
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
      }}>
      {deafened ? (
        <PiSpeakerSlashFill size={Math.round(size * 0.55)} color="#fff" />
      ) : (
        <PiMicrophoneSlashFill size={Math.round(size * 0.55)} color="#fff" />
      )}
    </div>
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
  if (ms === null) return "var(--gryt-neutral-9)";
  if (ms < 30) return "var(--gryt-success-9)";
  if (ms < 80) return "var(--gryt-warning-9)";
  return "var(--gryt-danger-9)";
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
    <Tooltip title={tooltipParts.join(" · ")}>
      <span className="text-xs" style={{
          color: latencyColor(oneWay),
          fontVariantNumeric: "tabular-nums",
          cursor: "default",
        }}>
        {Math.round(oneWay)}ms
      </span>
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
  streamSources,
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
  streamSources?: StreamSources;
  adminActions?: AdminActions;
  /** Overridden to 12 for the two-participant picture-in-picture tile. */
  tileRadius?: number;
}) {
  const isScreenTile = itemId.startsWith("screen:");
  const { framingByClient, localFraming } = useVideoFraming();
  const serverUserId: string | undefined = client?.serverUserId;

  // Above the screen-tile branch below, which returns early. A hook after an
  // early return only survives because a given card keeps the same itemId for
  // its whole life, which is not something to rely on.
  const tileRef = useRef<HTMLDivElement>(null);
  const tileHeight = useTileHeight(tileRef);

  // Same reason: above the early return. The two analysers the speaking check
  // reads — the post-gate microphone for yourself, the decoded remote stream
  // for everyone else. Passing false takes no microphone handle; useMicrophone
  // is a singleton, so this only reads what the voice connection already set up.
  const { microphoneBuffer } = useMicrophone(false);

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
        serverHost={serverHost}
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
          stalledLabel="Screen isn't coming through"
          statusIcons={<PiScreencastFill size={10} color="var(--gryt-secondary-9)" />}
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
        <span className="text-xs font-bold" style={{ color: "#fff" }}>
          AFK
        </span>
      )}

      {(client.cameraEnabled || fallbackCameraStreamID) && (
        <PiVideoCameraFill size={10} color="var(--gryt-success-9)" />
      )}

      {client.screenShareEnabled && (
        <PiScreencastFill size={10} color="var(--gryt-secondary-9)" />
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

  // The nickname, because that is what the avatar is drawn from — a tile tinted
  // from anything else is a colour that matches nothing on it.
  const hue = tileHue(client.nickname, memberInfo?.avatarColor);

  const speakingAnalyser = isSelf
    ? microphoneBuffer.finalAnalyser
    : client.streamID
      ? streamSources?.[client.streamID]?.analyser
      : undefined;

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
              // No stroke on the tile. Meet puts the whole speaking treatment
              // on the avatar — a ring plus the halo behind it — and leaves the
              // tile alone, so the card edge stays quiet however many people
              // are talking.
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }
      }
    >
      <div className="flex items-center justify-center relative">
        {!compact && (
          <SpeakingHalo analyser={speakingAnalyser} hue={hue} size={avatarPx} />
        )}

        <Avatar
          size={compact ? "small" : "medium"}
          fallback={client.nickname[0]}
          src={resolveAvatarSrc(
            avatarFileId
              ? // No thumbnail here on purpose. The tile draws avatars up to
                // ~96 CSS px, 192 on a 2x screen, which is past what the 128px
                // thumbnail can carry — and it is the one place an animated
                // avatar should still animate, which the thumbnail does not.
                getUploadsFileUrl(serverHost, avatarFileId)
              : undefined,
            client.nickname,
          )}
          style={{
            ...speakingRingStyle(hue, isSpeaking),
            // Stepped by tile height rather than Radix's size scale, so the
            // avatar tracks the tile the way Meet's does.
            ...(compact ? {} : { width: avatarPx, height: avatarPx }),
          }}
        />

        {(client.cameraEnabled || fallbackCameraStreamID) && (
          <div className="flex absolute" style={{ top: "-4px", right: "-4px", background: "var(--gryt-success-9)",
              borderRadius: "50%",
              padding: "2px" }}>
            <PiVideoCameraFill size={10} color="white" />
          </div>
        )}

        {client.screenShareEnabled && (
          <div className="flex absolute" style={{ top: "-4px", left: "-4px", background: "var(--gryt-secondary-9)",
              borderRadius: "50%",
              padding: "2px" }}>
            <PiScreencastFill size={10} color="white" />
          </div>
        )}

        {isUserConnecting && (
          <div className="flex absolute items-center justify-center" style={{
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "var(--gryt-neutral-a3)",
              borderRadius: "50%",
            }}>
            <SkeletonBase width="24px" height="24px" borderRadius="50%" />
          </div>
        )}

        {/* Mute state moved to the tile's top-right badge, so this chip is
            only still carrying it in the compact strip, which has no tile to
            hang a badge on. */}
        {((compact && (client.isMuted || client.isDeafened)) ||
          client.isAFK) && (
          <div className="flex absolute gap-1" style={{ bottom: "-4px", right: "-4px", background: "var(--gryt-neutral-3)",
              borderRadius: "var(--gryt-radius-md)",
              padding: "2px 4px",
              border: "1px solid var(--gryt-neutral-6)" }}>
            {compact && client.isDeafened ? (
              <PiSpeakerSlashFill size={12} color="var(--gryt-danger-9)" />
            ) : compact && client.isMuted ? (
              <PiMicrophoneSlashFill size={12} color="var(--gryt-danger-9)" />
            ) : null}

            {client.isAFK && (
              <span className="text-xs font-bold text-gryt-warning">
                AFK
              </span>
            )}
          </div>
        )}
      </div>

      {showMutedBadge && (
        <MutedBadge
          hueId={client.nickname}
          hueAvatarColor={memberInfo?.avatarColor}
          deafened={!!client.isDeafened}
          tileHeight={tileHeight}
        />
      )}

      {compact ? (
        <span className="text-xs">{client.nickname}</span>
      ) : (
        <div className="flex items-center gap-2" style={{
            // Bottom-left, 12 in and 9 up, measured off Meet. No scrim — the
            // tile's own colour carries the contrast.
            position: "absolute",
            bottom: isSmallTile ? 6 : 9,
            left: isSmallTile ? 8 : 12,
            right: isSmallTile ? 8 : 12,
            minWidth: 0,
          }}>
          <span className="font-medium truncate" style={{
              color: "#fff",
              fontSize: isSmallTile ? 12 : 16,
              lineHeight: 1.2,
            }}>
            {client.nickname}
          </span>
          {/* The latency figure is the first thing to go when there is no room
              for it — the name has to survive, the number does not. */}
          {showPeerLatency && !isSmallTile && (
            <LatencyBadge stats={latencyStats} isSelf={isSelf} />
          )}
        </div>
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
          objectPosition={toObjectPosition(
            isSelf ? localFraming : framingByClient[itemId],
            isSelf ? cameraMirrored : false,
          )}
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
      serverHost={serverHost}
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
