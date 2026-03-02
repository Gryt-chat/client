import { Flex, Slider, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MdFullscreenExit,
  MdOpenInNew,
  MdVolumeOff,
  MdVolumeUp,
} from "react-icons/md";

import { sliderToGain } from "@/lib/audioVolume";
import type { StreamSources } from "@/webRTC/src/types/SFU";

const HIDE_DELAY_MS = 2500;

const iconBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#fff",
  padding: 6,
  cursor: "pointer",
  borderRadius: "var(--radius-2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  opacity: 0.85,
};

export function FocusedVideoView({
  stream,
  title,
  audioStreamId,
  streamSources,
  objectFit = "contain",
  mirrored,
  onClose,
  onPopout,
}: {
  stream: MediaStream;
  title: string;
  audioStreamId?: string;
  streamSources?: StreamSources;
  objectFit?: "cover" | "contain";
  mirrored?: boolean;
  onClose: () => void;
  onPopout?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(100);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const hasAudio = !!(audioStreamId && streamSources?.[audioStreamId]);

  useEffect(() => {
    const sourceKeys = streamSources ? Object.keys(streamSources) : [];
    console.log(
      `[ScreenShare] FocusedVideoView: audioStreamId=${audioStreamId ?? "undefined"} inStreamSources=${!!(audioStreamId && streamSources?.[audioStreamId])} hasAudio=${hasAudio} streamSourceKeys=[${sourceKeys.join(", ")}]`,
    );
  }, [audioStreamId, streamSources, hasAudio]);

  const handleVolumeChange = useCallback(
    (values: number[]) => {
      const v = values[0];
      setVolume(v);
      if (audioStreamId && streamSources?.[audioStreamId]) {
        streamSources[audioStreamId].gain.gain.setValueAtTime(
          sliderToGain(v, 200),
          0,
        );
      }
    },
    [audioStreamId, streamSources],
  );

  const toggleMute = useCallback(() => {
    if (!hasAudio) return;
    const next = volume > 0 ? 0 : 100;
    setVolume(next);
    streamSources![audioStreamId!].gain.gain.setValueAtTime(
      sliderToGain(next, 200),
      0,
    );
  }, [hasAudio, audioStreamId, streamSources, volume]);

  const showControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setControlsVisible(true);
    hideTimer.current = setTimeout(() => setControlsVisible(false), HIDE_DELAY_MS);
  }, []);

  const keepControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setControlsVisible(true);
  }, []);

  const hideControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setControlsVisible(false);
  }, []);

  return (
    <Flex direction="column" style={{ flex: 1, minHeight: 0 }}>
      <div
        onClick={onClose}
        onContextMenu={(e) => e.preventDefault()}
        onMouseMove={showControls}
        onMouseLeave={hideControls}
        style={{
          flex: 1,
          position: "relative",
          borderRadius: "var(--radius-3)",
          overflow: "hidden",
          background: "#000",
          minHeight: 0,
          cursor: "pointer",
        }}
      >
        <video
          ref={ref}
          autoPlay
          playsInline
          muted
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit,
            pointerEvents: "none",
            transform: mirrored ? "scaleX(-1)" : undefined,
          }}
        />

        {/* Title overlay — top-left */}
        <Text
          size="1"
          weight="medium"
          truncate
          style={{
            position: "absolute",
            top: 10,
            left: 12,
            color: "#fff",
            textShadow: "0 1px 4px rgba(0,0,0,0.6)",
            maxWidth: "60%",
            opacity: controlsVisible ? 1 : 0,
            transition: "opacity 0.2s",
            pointerEvents: "none",
          }}
        >
          {title}
        </Text>

        {/* Bottom-right hover controls */}
        <Flex
          align="center"
          gap="2"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={keepControls}
          onMouseLeave={showControls}
          style={{
            position: "absolute",
            bottom: 12,
            right: 12,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(8px)",
            borderRadius: "var(--radius-3)",
            padding: "4px 8px",
            opacity: controlsVisible ? 1 : 0,
            transition: "opacity 0.2s",
          }}
        >
          {hasAudio && (
            <Flex align="center" gap="1" onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                style={iconBtnStyle}
                onClick={toggleMute}
                aria-label={volume > 0 ? "Mute stream" : "Unmute stream"}
              >
                {volume > 0 ? <MdVolumeUp size={16} /> : <MdVolumeOff size={16} />}
              </button>
              <Slider
                size="1"
                value={[volume]}
                onValueChange={handleVolumeChange}
                min={0}
                max={200}
                step={1}
                style={{ width: 80 }}
              />
            </Flex>
          )}

          {onPopout && (
            <button
              type="button"
              style={iconBtnStyle}
              onClick={onPopout}
              aria-label="Pop out video"
            >
              <MdOpenInNew size={16} />
            </button>
          )}

          <button
            type="button"
            style={iconBtnStyle}
            onClick={onClose}
            aria-label="Exit fullscreen"
          >
            <MdFullscreenExit size={16} />
          </button>
        </Flex>
      </div>
    </Flex>
  );
}
