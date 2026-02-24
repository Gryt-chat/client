import { Flex, Slider, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdClose, MdVolumeUp } from "react-icons/md";

import { sliderToGain } from "@/lib/audioVolume";
import type { StreamSources } from "@/webRTC/src/types/SFU";

export function FocusedVideoView({
  stream,
  title,
  audioStreamId,
  streamSources,
  objectFit = "contain",
  mirrored,
  onClose,
}: {
  stream: MediaStream;
  title: string;
  audioStreamId?: string;
  streamSources?: StreamSources;
  objectFit?: "cover" | "contain";
  mirrored?: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [volume, setVolume] = useState(100);

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

  const handleVolumeChange = useCallback((values: number[]) => {
    const v = values[0];
    setVolume(v);
    if (audioStreamId && streamSources?.[audioStreamId]) {
      const gain = streamSources[audioStreamId].gain;
      gain.gain.setValueAtTime(sliderToGain(v, 200), 0);
    }
  }, [audioStreamId, streamSources]);

  return (
    <Flex
      direction="column"
      gap="2"
      style={{ flex: 1, minHeight: 0, position: "relative" }}
    >
      <Flex
        align="center"
        gap="2"
        px="2"
        style={{
          background: "var(--gray-4)",
          borderRadius: "var(--radius-3)",
          padding: "4px 8px",
          flexShrink: 0,
        }}
      >
        <Text size="1" weight="medium" truncate style={{ flex: 1 }}>
          {title}
        </Text>
        {audioStreamId && streamSources?.[audioStreamId] && (
          <Flex align="center" gap="2" style={{ minWidth: 100 }}>
            <MdVolumeUp size={14} />
            <Slider
              size="1"
              value={[volume]}
              onValueChange={handleVolumeChange}
              min={0}
              max={200}
              step={1}
              style={{ flex: 1 }}
            />
          </Flex>
        )}
        <Flex
          asChild
          align="center"
          justify="center"
          style={{ cursor: "pointer", opacity: 0.7, flexShrink: 0 }}
          onClick={onClose}
        >
          <button style={{ background: "none", border: "none", color: "inherit", padding: 0, cursor: "pointer" }}>
            <MdClose size={16} />
          </button>
        </Flex>
      </Flex>
      <div
        onClick={onClose}
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
      </div>
    </Flex>
  );
}
