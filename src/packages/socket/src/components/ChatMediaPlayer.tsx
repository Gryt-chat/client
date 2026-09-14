import { useCallback, useEffect, useRef, useState } from "react";

import { PiPlayFill } from "../../../../lib/icons";
import { formatFileSize } from "../utils/formatFileSize";

/** Stands in for a video until it is clicked, so no video bytes load before then. */
export const VideoPoster = ({
  poster,
  onPlay,
  onPosterError,
  className = "chat-video-poster",
}: {
  poster?: string;
  onPlay: () => void;
  onPosterError?: () => void;
  className?: string;
}) => {
  const [ratio, setRatio] = useState<string | undefined>(undefined);
  return (
    <button
      type="button"
      className={className}
      aria-label="Play video"
      style={ratio ? { aspectRatio: ratio } : undefined}
      onClick={onPlay}
    >
      {poster && (
        <img
          src={poster}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w > 0 && h > 0) setRatio(`${w} / ${h}`);
          }}
          onError={onPosterError}
        />
      )}
      <span className="chat-video-poster-play">
        <PiPlayFill size={26} />
      </span>
    </button>
  );
};

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
  onStart,
}: {
  src: string;
  type: "audio" | "video";
  poster?: string;
  fileName?: string | null;
  size?: number | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  /** The load failed. The owner may hand back a new `src`, and playback picks up where it was. */
  onError?: () => void;
  onPosterError?: () => void;
  /** Called on the click that loads a video, before `src` is first used. */
  onStart?: () => void;
}) => {
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const suppressNextEvent = useRef(false);
  const resumeAt = useRef<number | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (mediaRef.current) {
      const linear = Math.max(0, Math.min(1, volume / 100));
      if (Math.abs(mediaRef.current.volume - linear) > 0.005) {
        suppressNextEvent.current = true;
        mediaRef.current.volume = linear;
      }
    }
  }, [volume, started]);

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

  const start = useCallback(() => {
    onStart?.();
    setStarted(true);
  }, [onStart]);

  const label = fileName
    ? `${fileName}${size != null ? ` · ${formatFileSize(size)}` : ""}`
    : null;

  if (type === "audio") {
    return (
      <div className="chat-audio-player">
        {label && <span className="chat-media-filename">{label}</span>}
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
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

  return (
    <div className="chat-video-player">
      {label && <span className="chat-media-filename">{label}</span>}
      {started ? (
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          controls
          autoPlay
          playsInline
          poster={poster}
          src={src}
          onVolumeChange={handleVolumeChange}
          onError={handleError}
          onLoadedMetadata={handleLoadedMetadata}
          onContextMenu={(e) => e.preventDefault()}
        />
      ) : (
        <VideoPoster poster={poster} onPlay={start} onPosterError={onPosterError} />
      )}
    </div>
  );
};
