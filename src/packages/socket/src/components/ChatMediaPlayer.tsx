import { VideoPlayer } from "@gryt/ui";
import { useCallback, useEffect, useRef } from "react";

import { useMediaErrors } from "../hooks/useMediaErrors";
import { formatFileSize } from "../utils/formatFileSize";

export const ChatMediaPlayer = ({
  src,
  type,
  poster,
  fileName,
  size,
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
  volume: number;
  onVolumeChange: (v: number) => void;
  /** The load failed. The owner may hand back a new `src`. */
  onError?: () => void;
  onPosterError?: () => void;
}) => {
  const label = fileName
    ? `${fileName}${size != null ? ` · ${formatFileSize(size)}` : ""}`
    : null;

  if (type === "video") {
    return (
      <ChatVideo
        src={src}
        poster={poster}
        label={label}
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
  volume,
  onVolumeChange,
  onError,
  onPosterError,
}: {
  src: string;
  poster?: string;
  label: string | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  onError?: () => void;
  onPosterError?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useMediaErrors(ref, onError, onPosterError);
  return (
    <div ref={ref} className="chat-video-player">
      <VideoPlayer src={src} poster={poster} fileName={label} volume={volume} onVolumeChange={onVolumeChange} />
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
