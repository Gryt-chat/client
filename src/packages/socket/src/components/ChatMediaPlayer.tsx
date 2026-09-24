import { Button, Spinner, VideoPlayer } from "@gryt/ui";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { PiWarningCircle } from "../../../../lib/icons";
import type { SealedVideo } from "../hooks/useSealedVideo";
import { formatFileSize } from "../utils/formatFileSize";

function mediaLabel(fileName?: string | null, size?: number | null): string | null {
  return fileName ? `${fileName}${size != null ? ` · ${formatFileSize(size)}` : ""}` : null;
}

/** The stored size as a CSS ratio, clamped: a sealed file's size is the sender's word for it. */
function videoRatio(width?: number | null, height?: number | null): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return Math.min(4, Math.max(1 / 4, width / height)).toFixed(4);
}

/** The player takes this shape before any of the video loads, so pressing play moves nothing (GRYT-1309). */
function sizedBy(width?: number | null, height?: number | null) {
  const ratio = videoRatio(width, height);
  return ratio ? { "data-sized": "", style: { "--chat-video-ratio": ratio } as CSSProperties } : {};
}

export const ChatMediaPlayer = ({
  src,
  type,
  poster,
  fileName,
  size,
  width,
  height,
  volume,
  onVolumeChange,
  onError,
  onPosterError,
}: {
  src: string;
  type: "audio" | "video";
  poster?: string;
  fileName?: string | null;
  size?: number | null;
  /** The video's display size as stored with the attachment, when there is one. */
  width?: number | null;
  height?: number | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  /** The load failed. The owner may hand back a new `src`. */
  onError?: () => void;
  onPosterError?: () => void;
}) => {
  const label = mediaLabel(fileName, size);

  if (type === "video") {
    return (
      <ChatVideo
        src={src}
        poster={poster}
        label={label}
        width={width}
        height={height}
        volume={volume}
        onVolumeChange={onVolumeChange}
        onError={onError}
        onPosterError={onPosterError}
      />
    );
  }

  return (
    <ChatAudio src={src} label={label} volume={volume} onVolumeChange={onVolumeChange} onError={onError} />
  );
};

function ChatVideo({
  src,
  poster,
  label,
  width,
  height,
  volume,
  onVolumeChange,
  onError,
  onPosterError,
}: {
  src: string;
  poster?: string;
  label: string | null;
  width?: number | null;
  height?: number | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  onError?: () => void;
  onPosterError?: () => void;
}) {
  return (
    <div className="chat-video-player" {...sizedBy(width, height)}>
      <VideoPlayer
        src={src}
        poster={poster}
        fileName={label}
        volume={volume}
        onVolumeChange={onVolumeChange}
        onError={onError}
        onPosterError={onPosterError}
      />
    </div>
  );
}

/**
 * An encrypted video, fetched and decrypted when play is pressed (GRYT-1171). The player is
 * inert until then, so the press lands on the button here and not on the player's own.
 */
export function ChatSealedVideo({
  video,
  fileName,
  size,
  width,
  height,
  volume,
  onVolumeChange,
}: {
  /** From useSealedVideo, held by the attachment so its menu can save the same file. */
  video: SealedVideo;
  fileName?: string | null;
  size?: number | null;
  /** From inside the sealed message: measured by the sender's app, never seen by the server. */
  width?: number | null;
  height?: number | null;
  volume: number;
  onVolumeChange: (v: number) => void;
}) {
  const { src, phase, start } = video;
  const box = useRef<HTMLDivElement | null>(null);
  const focused = useRef(false);

  const press = useCallback(() => {
    focused.current = box.current?.contains(document.activeElement) ?? false;
    start();
  }, [start]);

  // Once decrypted, press the player's own play button, so it starts the way a click would start it.
  useLayoutEffect(() => {
    const root = box.current?.querySelector<HTMLElement>(".gryt-video-player");
    if (!src || !root) return;
    root.querySelector<HTMLButtonElement>('button[aria-label="Play video"]')?.click();
    if (focused.current) root.focus();
  }, [src]);

  return (
    <div
      ref={box}
      className="chat-video-player relative"
      data-sealed={src ? undefined : phase}
      {...sizedBy(width, height)}
    >
      <div inert={!src}>
        <VideoPlayer
          src={src ?? ""}
          fileName={mediaLabel(fileName, size)}
          volume={volume}
          onVolumeChange={onVolumeChange}
        />
      </div>
      {!src && phase !== "failed" && (
        <button
          type="button"
          aria-label={phase === "opening" ? "Loading video" : "Play video"}
          aria-disabled={phase === "opening" || undefined}
          onClick={phase === "opening" ? undefined : press}
          className="absolute inset-0 grid cursor-pointer place-items-center rounded-(--gryt-radius-md) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gryt-accent-light aria-disabled:cursor-progress"
        >
          {/* Drawn over the player's play button, the same size and colour, so the button turns into the spinner. */}
          {phase === "opening" && (
            <span className="grid h-14 w-14 place-items-center rounded-(--gryt-radius-control) bg-gryt-accent">
              <Spinner size={28} aria-label="Loading video" className="text-gryt-on-accent" />
            </span>
          )}
        </button>
      )}
      {phase === "failed" && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-(--gryt-radius-md) bg-gryt-surface-raised p-4 text-center text-gryt-text"
        >
          <PiWarningCircle size={32} aria-hidden />
          <p className="m-0 text-sm">This video couldn't be played.</p>
          <Button size="xsmall" tone="neutral" onClick={press}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function ChatAudio({
  src,
  label,
  volume,
  onVolumeChange,
  onError,
}: {
  src: string;
  label: string | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  onError?: () => void;
}) {
  const mediaRef = useRef<HTMLAudioElement | null>(null);
  const suppressNextEvent = useRef(false);
  const resumeAt = useRef<number | null>(null);

  useEffect(() => {
    if (mediaRef.current) {
      const linear = Math.max(0, Math.min(1, volume / 100));
      if (Math.abs(mediaRef.current.volume - linear) > 0.005) {
        suppressNextEvent.current = true;
        mediaRef.current.volume = linear;
      }
    }
  }, [volume]);

  const handleVolumeChange = useCallback(() => {
    if (suppressNextEvent.current) {
      suppressNextEvent.current = false;
      return;
    }
    if (mediaRef.current) {
      const pct = Math.round(mediaRef.current.volume * 100);
      onVolumeChange(pct);
    }
  }, [onVolumeChange]);

  const handleError = useCallback(() => {
    const el = mediaRef.current;
    if (el && el.currentTime > 0) resumeAt.current = el.currentTime;
    onError?.();
  }, [onError]);

  const handleLoadedMetadata = useCallback(() => {
    const el = mediaRef.current;
    if (!el || resumeAt.current == null) return;
    el.currentTime = resumeAt.current;
    resumeAt.current = null;
    void el.play().catch(() => {});
  }, []);

  return (
    <div className="chat-audio-player">
      {label && <span className="chat-media-filename">{label}</span>}
      <audio
        ref={mediaRef}
        controls
        preload="metadata"
        src={src}
        onVolumeChange={handleVolumeChange}
        onError={handleError}
        onLoadedMetadata={handleLoadedMetadata}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
