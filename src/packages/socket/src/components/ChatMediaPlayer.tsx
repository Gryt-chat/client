import { useCallback, useEffect, useRef } from "react";

export const ChatMediaPlayer = ({
  src,
  type,
  poster,
  fileName,
  volume,
  onVolumeChange,
}: {
  src: string;
  type: "audio" | "video";
  poster?: string;
  fileName?: string | null;
  volume: number;
  onVolumeChange: (v: number) => void;
}) => {
  const mediaRef = useRef<HTMLAudioElement | HTMLVideoElement | null>(null);
  const suppressNextEvent = useRef(false);

  useEffect(() => {
    if (mediaRef.current) {
      const clamped = Math.max(0, Math.min(1, volume / 100));
      if (Math.abs(mediaRef.current.volume - clamped) > 0.005) {
        suppressNextEvent.current = true;
        mediaRef.current.volume = clamped;
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

  if (type === "audio") {
    return (
      <div className="chat-audio-player">
        {fileName && <span className="chat-media-filename">{fileName}</span>}
        <audio
          ref={mediaRef as React.RefObject<HTMLAudioElement>}
          controls
          preload="auto"
          src={src}
          onVolumeChange={handleVolumeChange}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    );
  }

  return (
    <div className="chat-video-player">
      {fileName && <span className="chat-media-filename">{fileName}</span>}
      <video
        ref={mediaRef as React.RefObject<HTMLVideoElement>}
        controls
        preload="metadata"
        playsInline
        poster={poster}
        src={src}
        onVolumeChange={handleVolumeChange}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
};
